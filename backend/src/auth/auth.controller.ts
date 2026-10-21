import {
  Body,
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { RateLimitService } from './rate-limit.service';
import { GenerateChallengeDto } from './dto/generate-challenge.dto';
import { VerifyChallengeDto } from './dto/verify-challenge.dto';
import { VerifyWalletDto } from './dto/verify-wallet.dto';
import { RateLimitStatusDto } from './dto/rate-limit-status.dto';
import { PasskeyAuthenticationFinishDto } from './dto/passkey-authentication.dto';
import {
  PasskeyRegistrationBeginDto,
  PasskeyRegistrationFinishDto,
} from './dto/passkey-registration.dto';
import {
  RefreshTokenResponseDto,
  RotateRefreshTokenDto,
} from './dto/refresh-token.dto';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { User } from '../users/entities/user.entity';
import { ConfigService } from '@nestjs/config';
import { ThrottleTier } from '../common/decorators/throttle-tier.decorator';
import { OAuthService, OAUTH_PROVIDERS, OAuthProvider } from './oauth.service';
import { OAuthExchangeDto } from './dto/oauth-exchange.dto';
import { OAuthStartDto } from './dto/oauth-start.dto';

@ApiTags('Auth')
@ThrottleTier('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly rateLimitService: RateLimitService,
    private readonly configService: ConfigService,
    private readonly oauthService: OAuthService,
  ) {}

  private readonly logger = new Logger(AuthController.name);

  @Public()
  @Get('oauth/providers')
  @ApiOperation({ summary: 'List configured social sign-in providers' })
  getOAuthProviders(): { providers: OAuthProvider[] } {
    return { providers: this.oauthService.availableProviders() };
  }

  @Public()
  @Post('oauth/:provider/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start social sign-in' })
  async startOAuthLogin(
    @Param('provider') provider: string,
    @Body() dto: OAuthStartDto,
  ): Promise<{ authorization_url: string }> {
    return {
      authorization_url: await this.oauthService.beginLogin(
        this.parseOAuthProvider(provider),
        dto.client_verifier,
        dto.return_to,
      ),
    };
  }

  @Post('oauth/:provider/link/start')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start linking a social account to this account' })
  async startOAuthLink(
    @Param('provider') provider: string,
    @CurrentUser() user: User,
    @Body() dto: OAuthStartDto,
  ): Promise<{ authorization_url: string }> {
    return {
      authorization_url: await this.oauthService.beginLink(
        this.parseOAuthProvider(provider),
        user.id,
        dto.client_verifier,
      ),
    };
  }

  @Get('oauth/identities')
  @ApiOperation({ summary: 'List linked social sign-in providers' })
  @ApiBearerAuth()
  async getOAuthIdentities(
    @CurrentUser() user: User,
  ): Promise<{ providers: OAuthProvider[] }> {
    return { providers: await this.oauthService.linkedProviders(user.id) };
  }

  @Public()
  @Post('oauth/exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a one-time social sign-in code for a session',
  })
  async exchangeOAuthCode(@Body() dto: OAuthExchangeDto) {
    return this.oauthService.exchangeCode(dto.code, dto.code_verifier);
  }

  @Public()
  @Get('oauth/callback')
  @ApiOperation({
    summary: 'Complete a social sign-in or account-link callback',
  })
  async oauthCallback(
    @Query('state') state: string,
    @Query('code') code: string,
    @Query('error') error: string,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const parsedProvider = await this.oauthService.providerForState(state);
      const redirectUrl = error
        ? await this.oauthService.completeProviderError(
            parsedProvider,
            state,
            error,
          )
        : await this.oauthService.completeCallback(parsedProvider, state, code);
      response.redirect(redirectUrl);
    } catch (exception) {
      if (!(exception instanceof HttpException)) throw exception;
      this.logger.warn(`OAuth callback failed: ${exception.message}`);
      response.redirect(await this.oauthService.callbackFailureForState(state));
    }
  }

  private parseOAuthProvider(provider: string): OAuthProvider {
    const supportedProvider = OAUTH_PROVIDERS.find(
      (candidate) => candidate === provider,
    );
    if (!supportedProvider) {
      throw new BadRequestException('Unsupported OAuth provider');
    }
    return supportedProvider;
  }

  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  generateChallenge(@Body() generateChallengeDto: GenerateChallengeDto) {
    const challenge = this.authService.generateChallenge(
      generateChallengeDto.stellar_address,
    );
    return { challenge };
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyChallenge(@Body() verifyChallengeDto: VerifyChallengeDto) {
    return this.authService.verifyChallenge(
      verifyChallengeDto.stellar_address,
      verifyChallengeDto.signed_challenge,
    );
  }

  @Post('verify-wallet')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify wallet signature without session creation' })
  @ApiResponse({ status: 200, description: 'Verification result' })
  verifyWallet(@Body() dto: VerifyWalletDto) {
    const verified = this.authService.verifyStellarSignature(
      dto.stellar_address,
      dto.challenge,
      dto.signature,
    );
    return { verified };
  }

  @Public()
  @Post('passkey/authenticate/begin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Begin a passkey login: get options for navigator.credentials.get()',
  })
  @ApiResponse({ status: 200, description: 'WebAuthn authentication options' })
  async beginPasskeyAuthentication() {
    return this.authService.beginPasskeyAuthentication();
  }

  @Public()
  @Post('passkey/authenticate/finish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete a passkey login by verifying the signed assertion',
  })
  @ApiResponse({
    status: 200,
    description: 'Access token, refresh token and user issued for the session',
  })
  @ApiResponse({
    status: 401,
    description:
      'Unauthorized - invalid, expired, or unrecognized passkey assertion',
  })
  async finishPasskeyAuthentication(
    @Body() dto: PasskeyAuthenticationFinishDto,
  ) {
    return this.authService.finishPasskeyAuthentication(dto.response);
  }

  @Post('passkey/register/begin')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Begin passkey registration: get options for navigator.credentials.create()',
    description:
      "Requires an authenticated session (via Stellar wallet signature or an existing passkey). Registration attaches a new passkey credential to the caller's account for future logins.",
  })
  @ApiResponse({ status: 200, description: 'WebAuthn registration options' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async beginPasskeyRegistration(
    @CurrentUser() user: User,
    @Body() dto: PasskeyRegistrationBeginDto,
  ) {
    return this.authService.beginPasskeyRegistration(user, dto.display_name);
  }

  @Post('passkey/register/finish')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Complete passkey registration by verifying the signed attestation and storing the credential',
  })
  @ApiResponse({
    status: 200,
    description: 'The newly registered passkey credential',
  })
  @ApiResponse({
    status: 401,
    description:
      'Unauthorized - invalid, expired attestation, or the challenge does not belong to the caller',
  })
  async finishPasskeyRegistration(
    @CurrentUser() user: User,
    @Body() dto: PasskeyRegistrationFinishDto,
  ) {
    const credential = await this.authService.finishPasskeyRegistration(
      user,
      dto.response,
    );
    return {
      id: credential.id,
      credential_id: credential.credential_id,
      device_type: credential.device_type,
      backed_up: credential.backed_up,
      created_at: credential.created_at,
    };
  }

  @Get('rate-limit')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current rate limit status for authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Current rate limit status per tier',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getRateLimitStatus(
    @CurrentUser() user: User,
  ): Promise<Record<string, RateLimitStatusDto>> {
    return this.rateLimitService.getStatus(user.id);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate a refresh token',
    description:
      'Exchanges a valid refresh token for a new access token and a new refresh token, invalidating the presented refresh token. Reusing an already-rotated refresh token revokes the entire session family.',
  })
  @ApiResponse({
    status: 200,
    description: 'New access token and refresh token issued',
    type: RefreshTokenResponseDto,
  })
  @ApiResponse({
    status: 401,
    description:
      'Unauthorized - invalid, expired, or reused refresh token, or user deleted',
  })
  async refreshToken(
    @Body() dto: RotateRefreshTokenDto,
  ): Promise<RefreshTokenResponseDto> {
    const { access_token, refresh_token } =
      await this.authService.rotateRefreshToken(dto.refresh_token);

    // Calculate expiry timestamp
    const expiresIn = this.configService.get<string>('JWT_EXPIRES_IN') || '7d';
    const expiresMs = this.parseExpiryToMs(expiresIn);
    const expires_at = new Date(Date.now() + expiresMs).toISOString();

    return { access_token, refresh_token, expires_at };
  }

  /**
   * Parse JWT_EXPIRES_IN format (e.g., '7d', '24h', '3600s') to milliseconds
   */
  private parseExpiryToMs(expiry: string): number {
    const match = expiry.match(/^(\d+)([dhms])$/);
    if (!match) {
      // Default to 7 days if format is invalid
      return 7 * 24 * 60 * 60 * 1000;
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'm':
        return value * 60 * 1000;
      case 's':
        return value * 1000;
      default:
        return 7 * 24 * 60 * 60 * 1000;
    }
  }
}
