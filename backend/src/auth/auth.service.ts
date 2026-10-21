import {
  Injectable,
  UnauthorizedException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { randomBytes, randomUUID, createHash } from 'crypto';
import { Keypair } from '@stellar/stellar-sdk';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialRequestOptionsJSON,
  type PublicKeyCredentialCreationOptionsJSON,
} from '@simplewebauthn/server';
import { IsNull, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserPreferences } from '../users/entities/user-preferences.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { AuthAuditEvent } from './entities/auth-audit-event.entity';
import { WebAuthnCredential } from './entities/webauthn-credential.entity';

const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 30;

@Injectable()
export class AuthService implements OnModuleInit {
  private challengeCache = new Map<
    string,
    { expiresAt: number; used: boolean }
  >();
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes

  private passkeyChallengeCache = new Map<
    string,
    { expiresAt: number; used: boolean }
  >();
  private readonly PASSKEY_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Pending passkey *registration* challenges, keyed by the challenge
   * itself (mirrors `passkeyChallengeCache`). Unlike login, registration
   * also records which authenticated user started the ceremony so
   * `finishPasskeyRegistration` can refuse to attach the resulting
   * credential to a different user than the one who began it.
   */
  private passkeyRegistrationChallengeCache = new Map<
    string,
    { userId: string; expiresAt: number; used: boolean }
  >();

  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(UserPreferences)
    private readonly preferencesRepository: Repository<UserPreferences>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokensRepository: Repository<RefreshToken>,
    @InjectRepository(AuthAuditEvent)
    private readonly authAuditEventsRepository: Repository<AuthAuditEvent>,
    @InjectRepository(WebAuthnCredential)
    private readonly webAuthnCredentialsRepository: Repository<WebAuthnCredential>,
  ) {}

  onModuleInit() {
    this.logger.log('AuthService initialized - periodic cleanup enabled');
  }

  /**
   * Periodically cleanup expired challenges every 5 minutes.
   * This prevents memory leaks in read-heavy load scenarios where
   * verifySignature is called frequently without intervening generateChallenge calls.
   */
  @Cron('*/5 * * * *')
  cleanupExpiredChallenges(): void {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.challengeCache.entries()) {
      if (now > entry.expiresAt) {
        this.challengeCache.delete(key);
        removed++;
      }
    }
    for (const [key, entry] of this.passkeyChallengeCache.entries()) {
      if (now > entry.expiresAt) {
        this.passkeyChallengeCache.delete(key);
        removed++;
      }
    }
    for (const [
      key,
      entry,
    ] of this.passkeyRegistrationChallengeCache.entries()) {
      if (now > entry.expiresAt) {
        this.passkeyRegistrationChallengeCache.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      this.logger.debug(
        `Periodic cleanup removed ${removed} expired challenge(s)`,
      );
    }
  }

  generateChallenge(stellar_address: string): string {
    const timestamp = Date.now();
    const random = randomBytes(16).toString('hex');
    const challenge = `InsightArena:nonce:${timestamp}:${random}:${stellar_address}`;

    this.logger.debug(
      `Generating challenge for ${stellar_address}: ${challenge}`,
    );

    this.challengeCache.set(challenge, {
      expiresAt: timestamp + this.TTL_MS,
      used: false,
    });

    return challenge;
  }

  isValidChallenge(challenge: string): boolean {
    const entry = this.challengeCache.get(challenge);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.challengeCache.delete(challenge);
      return false;
    }

    return true;
  }

  removeChallenge(challenge: string): void {
    this.challengeCache.delete(challenge);
  }

  async verifyChallenge(
    stellar_address: string,
    signed_challenge: string,
  ): Promise<{
    access_token: string;
    refresh_token: string;
    user: User;
    is_new_user: boolean;
  }> {
    const { user, is_new_user } = await this.verifySignatureWithStatus(
      stellar_address,
      signed_challenge,
    );

    const session = await this.createSession(user);
    return { ...session, user, is_new_user };
  }

  async createSession(
    user: User,
  ): Promise<{ access_token: string; refresh_token: string }> {
    // Sign JWT with sub: user.id
    const payload = { sub: user.id, stellar_address: user.stellar_address };
    const access_token = await this.jwtService.signAsync(payload);

    // Start a brand-new refresh token family for this login session.
    const familyId = randomUUID();
    const { raw: refresh_token } = await this.issueRefreshToken(
      user.id,
      familyId,
    );

    return { access_token, refresh_token };
  }

  /** sha256 hex digest — fast, deterministic lookup key for a raw refresh token. */
  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Mints and persists a fresh refresh token row for `userId` within
   * `familyId`. `previousTokenId` is set when this call is part of a
   * rotation (chains the new row back to the token it replaced).
   */
  private async issueRefreshToken(
    userId: string,
    familyId: string,
    previousTokenId: string | null = null,
  ): Promise<{ raw: string; entity: RefreshToken }> {
    const raw = randomBytes(48).toString('hex');
    const ttlDays =
      this.configService.get<number>('REFRESH_TOKEN_TTL_DAYS') ??
      DEFAULT_REFRESH_TOKEN_TTL_DAYS;
    const expires_at = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    const entity = this.refreshTokensRepository.create({
      user_id: userId,
      family_id: familyId,
      token_hash: this.hashToken(raw),
      previous_token_id: previousTokenId,
      expires_at,
    });
    const saved = await this.refreshTokensRepository.save(entity);

    return { raw, entity: saved };
  }

  /**
   * Rotates a refresh token: validates it, revokes it, and issues a new
   * token in the same family. If the presented token was already rotated
   * away (i.e. someone is replaying a stolen/used token), the entire
   * session family is revoked and an audit event is recorded.
   */
  async rotateRefreshToken(
    rawToken: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const tokenHash = this.hashToken(rawToken);
    const existing = await this.refreshTokensRepository.findOneBy({
      token_hash: tokenHash,
    });

    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const now = new Date();

    if (existing.expires_at < now) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (existing.revoked_at) {
      // Reuse of an already-rotated token: treat as compromise and revoke
      // the whole session family.
      await this.refreshTokensRepository.update(
        { family_id: existing.family_id, revoked_at: IsNull() },
        { revoked_at: now },
      );

      const auditEvent = this.authAuditEventsRepository.create({
        event_type: 'refresh_token_reuse_detected',
        user_id: existing.user_id,
        family_id: existing.family_id,
        metadata: { tokenId: existing.id },
      });
      await this.authAuditEventsRepository.save(auditEvent);

      this.logger.error(
        `Refresh token reuse detected for family ${existing.family_id}, user ${existing.user_id} — session revoked`,
      );

      throw new UnauthorizedException(
        'Refresh token reuse detected; session revoked',
      );
    }

    const user = await this.usersRepository.findOneBy({
      id: existing.user_id,
    });
    if (!user) {
      throw new UnauthorizedException('User not found or has been deleted');
    }

    // Invalidate the presented token.
    existing.revoked_at = now;
    await this.refreshTokensRepository.save(existing);

    // Issue the next token in the same family, chained to the one just used.
    const { raw: refresh_token } = await this.issueRefreshToken(
      user.id,
      existing.family_id,
      existing.id,
    );

    const payload = { sub: user.id, stellar_address: user.stellar_address };
    const access_token = await this.jwtService.signAsync(payload);

    this.logger.debug(`Refresh token rotated for user ${user.id}`);

    return { access_token, refresh_token };
  }

  async verifySignature(
    stellar_address: string,
    signed_challenge: string,
  ): Promise<User> {
    return (
      await this.verifySignatureWithStatus(stellar_address, signed_challenge)
    ).user;
  }

  private async verifySignatureWithStatus(
    stellar_address: string,
    signed_challenge: string,
  ): Promise<{ user: User; is_new_user: boolean }> {
    this.logger.debug(`Verifying challenge for ${stellar_address}`);

    // Find a valid, unused challenge for this address
    const challenge = this.findValidChallengeForAddress(stellar_address);
    if (!challenge) {
      this.logger.debug(`No valid challenge found for ${stellar_address}`);
      throw new UnauthorizedException(
        'No valid challenge found or challenge expired',
      );
    }

    this.logger.debug(`Found challenge: ${challenge}`);

    const entry = this.challengeCache.get(challenge)!;

    // Replay attack prevention: reject already-used nonces
    if (entry.used) {
      this.logger.debug(`Challenge already used for ${stellar_address}`);
      throw new UnauthorizedException('Challenge already used');
    }

    // Verify the Stellar signature cryptographically
    const isValid = this.verifyStellarSignature(
      stellar_address,
      challenge,
      signed_challenge,
    );

    this.logger.debug(`Signature valid: ${isValid}`);

    if (!isValid) {
      throw new UnauthorizedException('Invalid signature');
    }

    // Mark nonce as used (replay prevention)
    entry.used = true;

    // Upsert the user record
    let user = await this.usersRepository.findOneBy({ stellar_address });
    const isNewUser = !user;
    if (!user) {
      this.logger.debug(`Creating new user for ${stellar_address}`);
      user = this.usersRepository.create({ stellar_address });
    }
    user = await this.usersRepository.save(user);

    if (isNewUser) {
      const existingPrefs = await this.preferencesRepository.findOneBy({
        userId: user.id,
      });
      if (!existingPrefs) {
        const prefs = this.preferencesRepository.create({ userId: user.id });
        await this.preferencesRepository.save(prefs);
      }
    }

    return { user, is_new_user: isNewUser };
  }

  /** Finds the most recent valid (non-expired) challenge for a given address. */
  private findValidChallengeForAddress(stellar_address: string): string | null {
    const now = Date.now();
    for (const [key, entry] of this.challengeCache.entries()) {
      if (key.endsWith(`:${stellar_address}`) && now <= entry.expiresAt) {
        return key;
      }
    }
    return null;
  }

  /**
   * Verifies a Stellar Ed25519 signature.
   * @param stellar_address  The G... public key of the signer.
   * @param challenge        The plaintext challenge that was signed.
   * @param signed_challenge Hex-encoded signature produced by Freighter.
   */
  verifyStellarSignature(
    stellar_address: string,
    challenge: string,
    signed_challenge: string,
  ): boolean {
    try {
      const keypair = Keypair.fromPublicKey(stellar_address);
      const messageBuffer = Buffer.from(challenge, 'utf-8');
      const signatureBuffer = Buffer.from(signed_challenge, 'hex');
      const isValid = keypair.verify(messageBuffer, signatureBuffer);
      return isValid;
    } catch (error) {
      this.logger.error(`Error verifying signature: ${error}`);
      return false;
    }
  }

  // --- passkey (WebAuthn) login -------------------------------------------

  /** Starts a passkey login: returns options for `navigator.credentials.get()`. */
  async beginPasskeyAuthentication(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const rpID =
      this.configService.get<string>('WEBAUTHN_RP_ID') ?? 'localhost';

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
    });

    this.passkeyChallengeCache.set(options.challenge, {
      expiresAt: Date.now() + this.PASSKEY_TTL_MS,
      used: false,
    });

    return options;
  }

  /**
   * Completes a passkey login: verifies the signed assertion against the
   * caller's registered credential and, on success, issues a session the
   * same way `verifyChallenge` does for wallet logins.
   */
  async finishPasskeyAuthentication(
    assertionResponse: AuthenticationResponseJSON,
  ): Promise<{ access_token: string; refresh_token: string; user: User }> {
    const challenge = this.extractChallengeFromClientData(
      assertionResponse.response.clientDataJSON,
    );

    const challengeEntry = this.passkeyChallengeCache.get(challenge);
    if (
      !challengeEntry ||
      challengeEntry.used ||
      Date.now() > challengeEntry.expiresAt
    ) {
      throw new UnauthorizedException(
        'No valid passkey challenge found or challenge expired',
      );
    }

    const credential = await this.webAuthnCredentialsRepository.findOneBy({
      credential_id: assertionResponse.id,
    });
    if (!credential) {
      throw new UnauthorizedException('Passkey not recognized');
    }

    const rpID =
      this.configService.get<string>('WEBAUTHN_RP_ID') ?? 'localhost';
    const origin =
      this.configService.get<string>('WEBAUTHN_ORIGIN') ??
      'http://localhost:3000';

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response: assertionResponse,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: credential.credential_id,
          // Stored as a Node Buffer (bytea column); @simplewebauthn/server's
          // types want a plain Uint8Array<ArrayBuffer> — a Buffer already
          // satisfies that shape at runtime, but re-wrapping keeps the
          // static types honest without a cast.
          publicKey: new Uint8Array(credential.public_key),
          counter: Number(credential.counter),
          transports: (credential.transports ?? undefined) as
            | AuthenticatorTransportFuture[]
            | undefined,
        },
      });
    } catch (error) {
      this.logger.warn(`Passkey verification failed: ${error}`);
      throw new UnauthorizedException('Invalid passkey assertion');
    }

    if (!verification.verified) {
      throw new UnauthorizedException('Invalid passkey assertion');
    }

    // Replay attack prevention: reject already-used challenges.
    challengeEntry.used = true;

    credential.counter = String(verification.authenticationInfo.newCounter);
    credential.last_used_at = new Date();
    await this.webAuthnCredentialsRepository.save(credential);

    const user = await this.usersRepository.findOneBy({
      id: credential.user_id,
    });
    if (!user) {
      throw new UnauthorizedException('User not found or has been deleted');
    }

    const payload = { sub: user.id, stellar_address: user.stellar_address };
    const access_token = await this.jwtService.signAsync(payload);

    const familyId = randomUUID();
    const { raw: refresh_token } = await this.issueRefreshToken(
      user.id,
      familyId,
    );

    return { access_token, refresh_token, user };
  }

  /**
   * Pulls the WebAuthn challenge out of a signed assertion's clientDataJSON.
   * The browser echoes back the exact base64url challenge it was given, so
   * this lets a stateless server find which pending challenge to check the
   * assertion against before running full verification.
   */
  private extractChallengeFromClientData(clientDataJSON: string): string {
    try {
      const decoded = Buffer.from(clientDataJSON, 'base64url').toString('utf8');
      const parsed = JSON.parse(decoded) as { challenge?: string };
      if (!parsed.challenge) {
        throw new Error('missing challenge');
      }
      return parsed.challenge;
    } catch {
      throw new UnauthorizedException('Malformed passkey assertion');
    }
  }

  // --- passkey (WebAuthn) registration ------------------------------------
  //
  // Registration attaches a passkey credential to an ALREADY-authenticated
  // user (they've signed in via a Stellar wallet signature or an existing
  // passkey) so they can use a passkey for future logins — it does not
  // create a new user by itself. This mirrors typical WebAuthn UX: a
  // passkey is offered as an upgrade during/after onboarding, not as the
  // only way to first prove who you are.
  //
  // Only ES256 (COSE alg -7, secp256r1/P-256) credentials are accepted,
  // per this feature's scope — the broadest supported algorithm across
  // platform authenticators (Touch ID, Windows Hello, Android) and the one
  // explicitly requested for smart-wallet passkeys.
  private static readonly SECP256R1_COSE_ALG_ID = -7;

  /**
   * Starts a passkey registration ceremony for `user`: returns options for
   * `navigator.credentials.create()`, excluding any credentials the user
   * has already registered so the authenticator won't offer to re-register
   * the same passkey.
   */
  async beginPasskeyRegistration(
    user: User,
    displayName?: string,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const rpID =
      this.configService.get<string>('WEBAUTHN_RP_ID') ?? 'localhost';
    const rpName = this.configService.get<string>('WEBAUTHN_RP_NAME') ?? 'Stow';

    const existingCredentials = await this.webAuthnCredentialsRepository.find({
      where: { user_id: user.id },
    });

    const options = await generateRegistrationOptions({
      rpID,
      rpName,
      userName: user.username ?? user.stellar_address,
      userDisplayName: displayName ?? user.username ?? user.stellar_address,
      attestationType: 'none',
      excludeCredentials: existingCredentials.map((credential) => ({
        id: credential.credential_id,
        transports: (credential.transports ?? undefined) as
          | AuthenticatorTransportFuture[]
          | undefined,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      supportedAlgorithmIDs: [AuthService.SECP256R1_COSE_ALG_ID],
    });

    this.passkeyRegistrationChallengeCache.set(options.challenge, {
      userId: user.id,
      expiresAt: Date.now() + this.PASSKEY_TTL_MS,
      used: false,
    });

    return options;
  }

  /**
   * Completes a passkey registration ceremony: verifies the signed
   * attestation against the challenge issued to `user` and, on success,
   * persists a new `WebAuthnCredential` row for them.
   */
  async finishPasskeyRegistration(
    user: User,
    attestationResponse: RegistrationResponseJSON,
  ): Promise<WebAuthnCredential> {
    const challenge = this.extractChallengeFromClientData(
      attestationResponse.response.clientDataJSON,
    );

    const challengeEntry =
      this.passkeyRegistrationChallengeCache.get(challenge);
    if (
      !challengeEntry ||
      challengeEntry.used ||
      Date.now() > challengeEntry.expiresAt
    ) {
      throw new UnauthorizedException(
        'No valid passkey registration challenge found or challenge expired',
      );
    }

    // The challenge must have been issued to this exact user — otherwise
    // one user could complete a ceremony another user started.
    if (challengeEntry.userId !== user.id) {
      throw new UnauthorizedException(
        'Passkey registration challenge does not belong to this user',
      );
    }

    const rpID =
      this.configService.get<string>('WEBAUTHN_RP_ID') ?? 'localhost';
    const origin =
      this.configService.get<string>('WEBAUTHN_ORIGIN') ??
      'http://localhost:3000';

    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response: attestationResponse,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        supportedAlgorithmIDs: [AuthService.SECP256R1_COSE_ALG_ID],
      });
    } catch (error) {
      this.logger.warn(`Passkey registration verification failed: ${error}`);
      throw new UnauthorizedException('Invalid passkey registration response');
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new UnauthorizedException('Invalid passkey registration response');
    }

    // Replay attack prevention: reject already-used challenges.
    challengeEntry.used = true;

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    const existing = await this.webAuthnCredentialsRepository.findOneBy({
      credential_id: credential.id,
    });
    if (existing) {
      // The same physical/synced passkey was already registered (possibly
      // by this same user re-registering, or — extremely unlikely given
      // credential IDs are generated randomly by the authenticator — a
      // collision). Either way, don't create a duplicate row.
      throw new UnauthorizedException('This passkey is already registered');
    }

    const record = this.webAuthnCredentialsRepository.create({
      user_id: user.id,
      credential_id: credential.id,
      public_key: Buffer.from(credential.publicKey),
      counter: String(credential.counter),
      device_type: credentialDeviceType,
      backed_up: credentialBackedUp,
      transports: credential.transports ?? null,
    });

    const saved = await this.webAuthnCredentialsRepository.save(record);

    this.logger.debug(
      `Passkey credential ${credential.id} registered for user ${user.id}`,
    );

    return saved;
  }
}
