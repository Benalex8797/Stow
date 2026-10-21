import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import {
  createHash,
  createPublicKey,
  createSign,
  randomBytes,
  timingSafeEqual,
  type JsonWebKey as NodeJsonWebKey,
  verify as verifySignature,
} from 'node:crypto';
import { DeleteResult, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { OAuthIdentity } from './entities/oauth-identity.entity';
import { OAuthTransaction } from './entities/oauth-transaction.entity';

export const OAUTH_PROVIDERS = ['google', 'apple', 'github'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

type OAuthProfile = {
  subject: string;
  email: string | null;
  displayName: string | null;
};

type ProviderConfig = {
  clientId: string;
  clientSecret: string;
};

type AppleJwk = NodeJsonWebKey & { kid?: string; use?: string; alg?: string };

const OAUTH_TRANSACTION_TTL_MS = 5 * 60 * 1000;
const OAUTH_EXCHANGE_TTL_MS = 60 * 1000;
const OAUTH_TIMEOUT_MS = 10_000;

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private appleKeys: { expiresAt: number; keys: AppleJwk[] } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly authService: AuthService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(OAuthIdentity)
    private readonly identities: Repository<OAuthIdentity>,
    @InjectRepository(OAuthTransaction)
    private readonly transactions: Repository<OAuthTransaction>,
  ) {}

  availableProviders(): OAuthProvider[] {
    return OAUTH_PROVIDERS.filter((provider) => this.providerConfig(provider));
  }

  async beginLogin(
    provider: OAuthProvider,
    clientVerifier: string,
    returnTo?: string,
  ): Promise<string> {
    return this.begin(provider, 'login', null, clientVerifier, returnTo);
  }

  async beginLink(
    provider: OAuthProvider,
    userId: string,
    clientVerifier: string,
  ): Promise<string> {
    return this.begin(provider, 'link', userId, clientVerifier, '/settings');
  }

  async linkedProviders(userId: string): Promise<OAuthProvider[]> {
    const rows = await this.identities.find({
      where: { user_id: userId },
      select: { provider: true },
    });
    return rows.map((row) => row.provider as OAuthProvider);
  }

  async completeCallback(
    provider: OAuthProvider,
    state: string,
    code: string,
  ): Promise<string> {
    const transaction = await this.consumeState(provider, state);
    if (typeof code !== 'string' || !code) {
      throw new UnauthorizedException('OAuth authorization code is missing');
    }
    const profile = await this.fetchProfile(provider, code, transaction.nonce);

    if (transaction.intent === 'link') {
      if (!transaction.user_id) {
        throw new UnauthorizedException('OAuth link transaction is invalid');
      }
      await this.linkIdentity(transaction.user_id, provider, profile);
      return this.frontendUrl('/settings?oauth_linked=1');
    }

    const identity = await this.identities.findOneBy({
      provider,
      provider_user_id: profile.subject,
    });
    if (!identity) {
      return this.frontendUrl('/login?oauth_error=not_linked');
    }

    const user = await this.users.findOneBy({ id: identity.user_id });
    if (!user) {
      throw new UnauthorizedException('Linked account is no longer available');
    }

    const exchangeCode = randomBytes(32).toString('base64url');
    transaction.user_id = user.id;
    transaction.exchange_code_hash = this.hash(exchangeCode);
    transaction.expires_at = new Date(Date.now() + OAUTH_EXCHANGE_TTL_MS);
    await this.transactions.save(transaction);

    const returnTo = transaction.return_to ?? '/savings';
    return this.frontendUrl(
      `/login#oauth_code=${encodeURIComponent(exchangeCode)}&returnTo=${encodeURIComponent(returnTo)}`,
    );
  }

  async providerForState(state: string): Promise<OAuthProvider> {
    if (typeof state !== 'string' || !state) {
      throw new UnauthorizedException('OAuth state is invalid or expired');
    }
    const transaction = await this.transactions.findOneBy({
      state_hash: this.hash(state),
      consumed_at: IsNull(),
    });
    const provider = OAUTH_PROVIDERS.find(
      (candidate) => candidate === transaction?.provider,
    );
    if (
      !transaction ||
      transaction.expires_at.getTime() <= Date.now() ||
      !provider
    ) {
      throw new UnauthorizedException('OAuth state is invalid or expired');
    }
    return provider;
  }

  async completeProviderError(
    provider: OAuthProvider,
    state: string,
    error: string,
  ): Promise<string> {
    const transaction = await this.consumeState(provider, state);
    const message = error === 'access_denied' ? 'cancelled' : 'failed';
    return transaction.intent === 'link'
      ? this.frontendUrl(`/settings?oauth_error=${message}`)
      : this.frontendUrl(`/login?oauth_error=${message}`);
  }

  async callbackFailureForState(state: string): Promise<string> {
    if (typeof state !== 'string' || !state) {
      return this.frontendUrl('/login?oauth_error=failed');
    }
    const transaction = await this.transactions.findOneBy({
      state_hash: this.hash(state),
    });
    return transaction?.intent === 'link'
      ? this.frontendUrl('/settings?oauth_error=failed')
      : this.frontendUrl('/login?oauth_error=failed');
  }

  async exchangeCode(
    code: string,
    codeVerifier: string,
  ): Promise<{
    access_token: string;
    refresh_token: string;
    user: User;
  }> {
    if (typeof code !== 'string' || !code || code.length > 128) {
      throw new UnauthorizedException(
        'OAuth exchange code is invalid or expired',
      );
    }
    const transaction = await this.transactions.findOneBy({
      exchange_code_hash: this.hash(code),
      exchanged_at: IsNull(),
    });
    if (
      !transaction ||
      transaction.expires_at.getTime() <= Date.now() ||
      !transaction.user_id ||
      !this.matchesClientVerifier(
        transaction.client_verifier_hash,
        codeVerifier,
      )
    ) {
      throw new UnauthorizedException(
        'OAuth exchange code is invalid or expired',
      );
    }

    const exchanged = await this.transactions.update(
      {
        id: transaction.id,
        exchanged_at: IsNull(),
        expires_at: MoreThan(new Date()),
      },
      { exchanged_at: new Date() },
    );
    if (exchanged.affected !== 1) {
      throw new UnauthorizedException(
        'OAuth exchange code is invalid or expired',
      );
    }

    const user = await this.users.findOneBy({ id: transaction.user_id });
    if (!user) {
      throw new UnauthorizedException('Linked account is no longer available');
    }
    return { ...(await this.authService.createSession(user)), user };
  }

  @Cron('*/5 * * * *')
  async cleanupExpiredTransactions(): Promise<DeleteResult> {
    return this.transactions.delete({ expires_at: LessThan(new Date()) });
  }

  private async begin(
    provider: OAuthProvider,
    intent: 'login' | 'link',
    userId: string | null,
    clientVerifier: string,
    returnTo?: string,
  ): Promise<string> {
    const providerConfig = this.providerConfig(provider);
    if (!providerConfig) {
      throw new ServiceUnavailableException(
        `${provider} sign-in is not configured`,
      );
    }
    if (!this.isValidClientVerifier(clientVerifier)) {
      throw new BadRequestException('OAuth client verifier is invalid');
    }
    if (intent === 'link' && userId) {
      const user = await this.users.findOneBy({ id: userId });
      if (!user) throw new UnauthorizedException('Account not found');
    }

    const state = randomBytes(32).toString('base64url');
    const nonce =
      provider === 'apple' ? randomBytes(32).toString('base64url') : null;
    const transaction = this.transactions.create({
      state_hash: this.hash(state),
      provider,
      intent,
      user_id: userId,
      nonce,
      client_verifier_hash: this.hash(clientVerifier),
      expires_at: new Date(Date.now() + OAUTH_TRANSACTION_TTL_MS),
      consumed_at: null,
      exchange_code_hash: null,
      exchanged_at: null,
      return_to: this.safeReturnTo(returnTo),
    });
    await this.transactions.save(transaction);

    const url = new URL(this.authorizationEndpoint(provider));
    url.searchParams.set('client_id', providerConfig.clientId);
    url.searchParams.set('redirect_uri', this.callbackUrl());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    url.searchParams.set('scope', this.scopes(provider));
    if (nonce) url.searchParams.set('nonce', nonce);
    if (provider === 'apple') url.searchParams.set('response_mode', 'query');
    if (provider === 'google') url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  private async consumeState(
    provider: OAuthProvider,
    state: string,
  ): Promise<OAuthTransaction> {
    if (typeof state !== 'string' || !state) {
      throw new UnauthorizedException('OAuth state is invalid or expired');
    }
    const transaction = await this.transactions.findOneBy({
      state_hash: this.hash(state),
      provider,
      consumed_at: IsNull(),
    });
    if (!transaction || transaction.expires_at.getTime() <= Date.now()) {
      throw new UnauthorizedException('OAuth state is invalid or expired');
    }

    const result = await this.transactions.update(
      {
        id: transaction.id,
        consumed_at: IsNull(),
        expires_at: MoreThan(new Date()),
      },
      { consumed_at: new Date() },
    );
    if (result.affected !== 1) {
      throw new UnauthorizedException('OAuth state is invalid or expired');
    }
    return transaction;
  }

  private async linkIdentity(
    userId: string,
    provider: OAuthProvider,
    profile: OAuthProfile,
  ): Promise<void> {
    const existingBySubject = await this.identities.findOneBy({
      provider,
      provider_user_id: profile.subject,
    });
    if (existingBySubject && existingBySubject.user_id !== userId) {
      throw new BadRequestException(
        'This social account is already linked to another Stow account',
      );
    }

    const existingForProvider = await this.identities.findOneBy({
      user_id: userId,
      provider,
    });
    if (
      existingForProvider &&
      existingForProvider.provider_user_id !== profile.subject
    ) {
      throw new BadRequestException(
        `A different ${provider} account is already linked`,
      );
    }

    const identity =
      existingBySubject ??
      this.identities.create({
        user_id: userId,
        provider,
        provider_user_id: profile.subject,
      });
    identity.email = profile.email;
    identity.display_name = profile.displayName;
    await this.identities.save(identity);
  }

  private async fetchProfile(
    provider: OAuthProvider,
    code: string,
    nonce: string | null,
  ): Promise<OAuthProfile> {
    const config = this.providerConfig(provider);
    if (!config) {
      throw new ServiceUnavailableException(
        `${provider} sign-in is not configured`,
      );
    }
    const token = await this.exchangeProviderCode(provider, config, code);

    if (provider === 'apple') {
      const claims = await this.verifyAppleIdToken(token.id_token, nonce);
      return {
        subject: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : null,
        displayName: null,
      };
    }

    const accessToken = this.requiredString(token.access_token, 'access token');
    if (provider === 'google') {
      const profile = await this.requestJson(
        'https://openidconnect.googleapis.com/v1/userinfo',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (profile.email_verified !== true) {
        throw new UnauthorizedException('Google email address is not verified');
      }
      return {
        subject: this.requiredString(profile.sub, 'Google subject'),
        email: this.optionalString(profile.email),
        displayName: this.optionalString(profile.name),
      };
    }

    const profile = await this.requestJson('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    const subject = profile.id;
    if (
      typeof subject !== 'number' &&
      (typeof subject !== 'string' || !subject.length)
    ) {
      throw new UnauthorizedException('GitHub account ID is missing');
    }
    const email = await this.githubEmail(accessToken);
    return {
      subject: String(subject),
      email,
      displayName:
        this.optionalString(profile.name) ?? this.optionalString(profile.login),
    };
  }

  private async exchangeProviderCode(
    provider: OAuthProvider,
    config: ProviderConfig,
    code: string,
  ): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({
      client_id: config.clientId,
      client_secret:
        provider === 'apple'
          ? this.createAppleClientSecret(config.clientId)
          : config.clientSecret,
      code,
      redirect_uri: this.callbackUrl(),
      grant_type: 'authorization_code',
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };
    if (provider === 'github') {
      headers.Accept = 'application/json';
    }
    return this.requestJson(this.tokenEndpoint(provider), {
      method: 'POST',
      headers,
      body: params.toString(),
    });
  }

  private async githubEmail(accessToken: string): Promise<string | null> {
    const emails = await this.requestJsonArray(
      'https://api.github.com/user/emails',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    const verified = emails
      .filter(
        (entry) => entry.verified === true && typeof entry.email === 'string',
      )
      .sort((a, b) => Number(b.primary === true) - Number(a.primary === true));
    return verified.length ? this.optionalString(verified[0].email) : null;
  }

  private async verifyAppleIdToken(
    idTokenValue: unknown,
    expectedNonce: string | null,
  ): Promise<Record<string, unknown> & { sub: string }> {
    const token = this.requiredString(idTokenValue, 'Apple ID token');
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Apple ID token is invalid');
    }

    let header: Record<string, unknown>;
    let claims: Record<string, unknown>;
    try {
      header = this.parseJwtPart(parts[0]);
      claims = this.parseJwtPart(parts[1]);
    } catch {
      throw new UnauthorizedException('Apple ID token is invalid');
    }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
      throw new UnauthorizedException('Apple ID token algorithm is invalid');
    }

    const key = await this.appleSigningKey(header.kid);
    const signedContent = `${parts[0]}.${parts[1]}`;
    const validSignature = verifySignature(
      'RSA-SHA256',
      Buffer.from(signedContent),
      createPublicKey({ key, format: 'jwk' }),
      Buffer.from(parts[2], 'base64url'),
    );
    const audience = claims.aud;
    const clientId = this.config.get<string>('APPLE_CLIENT_ID');
    const validAudience =
      audience === clientId ||
      (Array.isArray(audience) && audience.includes(clientId));
    if (
      !validSignature ||
      claims.iss !== 'https://appleid.apple.com' ||
      !validAudience ||
      typeof claims.exp !== 'number' ||
      claims.exp <= Math.floor(Date.now() / 1000) ||
      typeof claims.sub !== 'string' ||
      !expectedNonce ||
      !this.constantTimeEquals(claims.nonce, expectedNonce)
    ) {
      throw new UnauthorizedException('Apple ID token is invalid');
    }
    return claims as Record<string, unknown> & { sub: string };
  }

  private async appleSigningKey(kid: string): Promise<AppleJwk> {
    if (!this.appleKeys || this.appleKeys.expiresAt <= Date.now()) {
      const response = await this.requestJson(
        'https://appleid.apple.com/auth/keys',
      );
      const rawKeys = response.keys;
      if (!Array.isArray(rawKeys)) {
        throw new ServiceUnavailableException(
          'Apple signing keys are unavailable',
        );
      }
      this.appleKeys = {
        keys: rawKeys as AppleJwk[],
        expiresAt: Date.now() + 60 * 60 * 1000,
      };
    }
    const key = this.appleKeys.keys.find((entry) => entry.kid === kid);
    if (!key) {
      this.appleKeys = null;
      return this.appleSigningKey(kid);
    }
    return key;
  }

  private createAppleClientSecret(clientId: string): string {
    const teamId = this.config.get<string>('APPLE_TEAM_ID');
    const keyId = this.config.get<string>('APPLE_KEY_ID');
    const privateKey = this.config
      .get<string>('APPLE_PRIVATE_KEY')
      ?.replace(/\\n/g, '\n');
    if (!teamId || !keyId || !privateKey) {
      throw new ServiceUnavailableException('Apple sign-in is not configured');
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    const header = this.encodeJson({ alg: 'ES256', kid: keyId });
    const payload = this.encodeJson({
      iss: teamId,
      iat: issuedAt,
      exp: issuedAt + 5 * 60,
      aud: 'https://appleid.apple.com',
      sub: clientId,
    });
    const signingInput = `${header}.${payload}`;
    const signer = createSign('SHA256');
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign({
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    });
    return `${signingInput}.${signature.toString('base64url')}`;
  }

  private async requestJson(
    url: string,
    init: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    const response = await this.request(url, init);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ServiceUnavailableException(
        'OAuth provider returned an invalid response',
      );
    }
    if (!response.ok) {
      this.logger.warn(`OAuth provider request failed: ${response.status}`);
      throw new UnauthorizedException('OAuth provider rejected authentication');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ServiceUnavailableException(
        'OAuth provider returned an invalid response',
      );
    }
    return body as Record<string, unknown>;
  }

  private async requestJsonArray(
    url: string,
    init: RequestInit,
  ): Promise<Record<string, unknown>[]> {
    const response = await this.request(url, init);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ServiceUnavailableException(
        'OAuth provider returned an invalid response',
      );
    }
    if (!response.ok) {
      this.logger.warn(`OAuth provider request failed: ${response.status}`);
      throw new UnauthorizedException('OAuth provider rejected authentication');
    }
    if (!Array.isArray(body)) {
      throw new ServiceUnavailableException(
        'OAuth provider returned an invalid response',
      );
    }
    return body.filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
    );
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OAUTH_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
        redirect: 'error',
      });
    } catch (error) {
      this.logger.warn(
        `OAuth provider request failed: ${error instanceof Error ? error.message : 'network error'}`,
      );
      throw new ServiceUnavailableException('OAuth provider is unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }

  private providerConfig(provider: OAuthProvider): ProviderConfig | null {
    const clientId = this.config.get<string>(
      `${provider.toUpperCase()}_CLIENT_ID`,
    );
    const clientSecret =
      provider === 'apple'
        ? this.config.get<string>('APPLE_PRIVATE_KEY')
        : this.config.get<string>(`${provider.toUpperCase()}_CLIENT_SECRET`);
    if (!clientId || !clientSecret) return null;
    if (
      provider === 'apple' &&
      (!this.config.get<string>('APPLE_TEAM_ID') ||
        !this.config.get<string>('APPLE_KEY_ID'))
    ) {
      return null;
    }
    return { clientId, clientSecret };
  }

  private authorizationEndpoint(provider: OAuthProvider): string {
    switch (provider) {
      case 'google':
        return 'https://accounts.google.com/o/oauth2/v2/auth';
      case 'apple':
        return 'https://appleid.apple.com/auth/authorize';
      case 'github':
        return 'https://github.com/login/oauth/authorize';
    }
  }

  private tokenEndpoint(provider: OAuthProvider): string {
    switch (provider) {
      case 'google':
        return 'https://oauth2.googleapis.com/token';
      case 'apple':
        return 'https://appleid.apple.com/auth/token';
      case 'github':
        return 'https://github.com/login/oauth/access_token';
    }
  }

  private scopes(provider: OAuthProvider): string {
    switch (provider) {
      case 'google':
        return 'openid email profile';
      case 'apple':
        return 'name email';
      case 'github':
        return 'read:user user:email';
    }
  }

  private callbackUrl(): string {
    const configured = this.config.get<string>('OAUTH_CALLBACK_URL');
    if (configured) return configured;
    const backendUrl = (
      this.config.get<string>('BACKEND_URL') ?? 'http://localhost:3000'
    ).replace(/\/$/, '');
    return `${backendUrl}/api/v1/auth/oauth/callback`;
  }

  private frontendUrl(path: string): string {
    const base =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3001';
    return new URL(path, base).toString();
  }

  private safeReturnTo(path?: string): string {
    if (
      !path ||
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('\\')
    ) {
      return '/savings';
    }
    const frontend = new URL(
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3001',
    );
    const destination = new URL(path, frontend);
    if (destination.origin !== frontend.origin) return '/savings';
    return `${destination.pathname}${destination.search}${destination.hash}`.slice(
      0,
      512,
    );
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private isValidClientVerifier(value: string | undefined): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value);
  }

  private matchesClientVerifier(
    expectedHash: string,
    verifier: string,
  ): boolean {
    if (
      !this.isValidClientVerifier(verifier) ||
      !/^[a-f0-9]{64}$/.test(expectedHash)
    ) {
      return false;
    }
    const expected = Buffer.from(expectedHash, 'hex');
    const actual = Buffer.from(this.hash(verifier), 'hex');
    return timingSafeEqual(expected, actual);
  }

  private constantTimeEquals(value: unknown, expected: string): boolean {
    if (typeof value !== 'string') return false;
    const left = Buffer.from(value);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private parseJwtPart(value: string): Record<string, unknown> {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid JWT segment');
    }
    return parsed as Record<string, unknown>;
  }

  private encodeJson(value: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  private requiredString(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value) {
      throw new UnauthorizedException(`OAuth ${label} is missing`);
    }
    return value;
  }

  private optionalString(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
  }
}
