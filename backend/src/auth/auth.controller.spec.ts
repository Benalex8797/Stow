import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { User } from '../users/entities/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { VerifyChallengeDto } from './dto/verify-challenge.dto';
import { PasskeyAuthenticationFinishDto } from './dto/passkey-authentication.dto';
import {
  PasskeyRegistrationBeginDto,
  PasskeyRegistrationFinishDto,
} from './dto/passkey-registration.dto';
import { WebAuthnCredential } from './entities/webauthn-credential.entity';
import { RateLimitService } from './rate-limit.service';
import { OAuthService } from './oauth.service';

const mockAuthService = () => ({
  generateChallenge: jest
    .fn()
    .mockImplementation(
      (address: string) => `InsightArena:nonce:1234567890:randomhex:${address}`,
    ),
  verifyChallenge: jest.fn(),
  verifyStellarSignature: jest.fn(),
  rotateRefreshToken: jest.fn(),
  beginPasskeyAuthentication: jest.fn(),
  finishPasskeyAuthentication: jest.fn(),
  beginPasskeyRegistration: jest.fn(),
  finishPasskeyRegistration: jest.fn(),
});

const mockConfigService = () => ({
  get: jest.fn().mockReturnValue('7d'),
});

describe('AuthController', () => {
  let controller: AuthController;
  let authService: ReturnType<typeof mockAuthService>;
  let configService: ReturnType<typeof mockConfigService>;
  let oauthService: Record<string, jest.Mock>;

  beforeEach(async () => {
    oauthService = {
      availableProviders: jest.fn().mockReturnValue([]),
      linkedProviders: jest.fn().mockResolvedValue([]),
      beginLogin: jest.fn(),
      beginLink: jest.fn(),
      providerForState: jest.fn().mockResolvedValue('google'),
      completeCallback: jest.fn(),
      completeProviderError: jest.fn(),
      callbackFailureForState: jest.fn(),
      exchangeCode: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService() },
        {
          provide: RateLimitService,
          useValue: { getStatus: jest.fn() },
        },
        { provide: ConfigService, useValue: mockConfigService() },
        {
          provide: OAuthService,
          useValue: oauthService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService);
    configService = module.get(ConfigService);
  });

  describe('OAuth sign-in', () => {
    it('starts sign-in with the browser verifier and safe return path', async () => {
      const dto = {
        client_verifier: 'a'.repeat(64),
        return_to: '/settings',
      };
      oauthService.beginLogin.mockResolvedValue(
        'https://accounts.google.com/o/oauth2/v2/auth',
      );

      await expect(controller.startOAuthLogin('google', dto)).resolves.toEqual({
        authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth',
      });
      expect(oauthService.beginLogin).toHaveBeenCalledWith(
        'google',
        dto.client_verifier,
        dto.return_to,
      );
    });

    it('passes the browser verifier when exchanging the one-time code', async () => {
      const dto = {
        code: 'single-use-code',
        code_verifier: 'a'.repeat(64),
      };
      oauthService.exchangeCode.mockResolvedValue({ access_token: 'token' });

      await controller.exchangeOAuthCode(dto);

      expect(oauthService.exchangeCode).toHaveBeenCalledWith(
        dto.code,
        dto.code_verifier,
      );
    });
  });

  describe('generateChallenge', () => {
    it('returns a challenge string for a valid stellar_address', () => {
      const result = controller.generateChallenge({ stellar_address: 'GABC' });
      expect(authService.generateChallenge).toHaveBeenCalledWith('GABC');
      expect(result.challenge).toMatch(/^InsightArena:nonce:/);
    });
  });

  describe('verifyChallenge', () => {
    const dto: VerifyChallengeDto = {
      stellar_address: 'GABC123XYZ',
      signed_challenge: 'aabbcc',
    };

    it('returns { access_token, user } on valid input', async () => {
      const user = Object.assign(new User(), {
        id: 'uuid-1',
        stellar_address: dto.stellar_address,
      });
      authService.verifyChallenge.mockResolvedValue({
        access_token: 'signed.jwt.token',
        user,
      });

      const result = await controller.verifyChallenge(dto);

      expect(authService.verifyChallenge).toHaveBeenCalledWith(
        dto.stellar_address,
        dto.signed_challenge,
      );
      expect(result).toEqual({ access_token: 'signed.jwt.token', user });
    });

    it('propagates UnauthorizedException from the service (invalid signature)', async () => {
      authService.verifyChallenge.mockRejectedValue(
        new UnauthorizedException('Invalid signature'),
      );

      await expect(controller.verifyChallenge(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('propagates UnauthorizedException from the service (expired nonce)', async () => {
      authService.verifyChallenge.mockRejectedValue(
        new UnauthorizedException(
          'No valid challenge found or challenge expired',
        ),
      );

      await expect(controller.verifyChallenge(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('propagates UnauthorizedException from the service (replay attack)', async () => {
      authService.verifyChallenge.mockRejectedValue(
        new UnauthorizedException('Challenge already used'),
      );

      await expect(controller.verifyChallenge(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('beginPasskeyAuthentication', () => {
    it('returns the WebAuthn authentication options from the service', async () => {
      const options = { challenge: 'abc123', rpId: 'localhost' };
      authService.beginPasskeyAuthentication.mockResolvedValue(options);

      const result = await controller.beginPasskeyAuthentication();

      expect(result).toEqual(options);
    });
  });

  describe('finishPasskeyAuthentication', () => {
    const dto = {
      response: {
        id: 'cred-id-1',
        rawId: 'cred-id-1',
        type: 'public-key',
        response: {
          clientDataJSON: 'client-data',
          authenticatorData: 'auth-data',
          signature: 'sig',
        },
        clientExtensionResults: {},
      },
    } as unknown as PasskeyAuthenticationFinishDto;

    it('returns access_token, refresh_token and user for a valid assertion', async () => {
      const user = Object.assign(new User(), {
        id: 'uuid-1',
        stellar_address: 'GPASSKEY',
      });
      authService.finishPasskeyAuthentication.mockResolvedValue({
        access_token: 'passkey.jwt.token',
        refresh_token: 'raw-refresh-token',
        user,
      });

      const result = await controller.finishPasskeyAuthentication(dto);

      expect(authService.finishPasskeyAuthentication).toHaveBeenCalledWith(
        dto.response,
      );
      expect(result).toEqual({
        access_token: 'passkey.jwt.token',
        refresh_token: 'raw-refresh-token',
        user,
      });
    });

    it('propagates UnauthorizedException for an invalid assertion', async () => {
      authService.finishPasskeyAuthentication.mockRejectedValue(
        new UnauthorizedException('Invalid passkey assertion'),
      );

      await expect(controller.finishPasskeyAuthentication(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('beginPasskeyRegistration', () => {
    const currentUser = Object.assign(new User(), {
      id: 'uuid-reg-1',
      stellar_address: 'GREGUSER',
    });

    it('returns the WebAuthn registration options from the service, passing the current user and display name', async () => {
      const options = {
        challenge: 'reg-challenge',
        rp: { id: 'localhost', name: 'Stow' },
      };
      authService.beginPasskeyRegistration.mockResolvedValue(options);

      const dto: PasskeyRegistrationBeginDto = { display_name: 'My Phone' };
      const result = await controller.beginPasskeyRegistration(
        currentUser,
        dto,
      );

      expect(authService.beginPasskeyRegistration).toHaveBeenCalledWith(
        currentUser,
        'My Phone',
      );
      expect(result).toEqual(options);
    });

    it('passes through an undefined display name when none is given', async () => {
      authService.beginPasskeyRegistration.mockResolvedValue({
        challenge: 'reg-challenge',
      });

      await controller.beginPasskeyRegistration(currentUser, {});

      expect(authService.beginPasskeyRegistration).toHaveBeenCalledWith(
        currentUser,
        undefined,
      );
    });
  });

  describe('finishPasskeyRegistration', () => {
    const currentUser = Object.assign(new User(), {
      id: 'uuid-reg-1',
      stellar_address: 'GREGUSER',
    });

    const dto = {
      response: {
        id: 'new-cred-id-1',
        rawId: 'new-cred-id-1',
        type: 'public-key',
        response: {
          clientDataJSON: 'client-data',
          attestationObject: 'attestation-object',
        },
        clientExtensionResults: {},
      },
    } as unknown as PasskeyRegistrationFinishDto;

    it('returns a shaped credential summary (no public key bytes) for a valid attestation', async () => {
      const credential = Object.assign(new WebAuthnCredential(), {
        id: 'row-1',
        user_id: 'uuid-reg-1',
        credential_id: 'new-cred-id-1',
        public_key: Buffer.from('should-not-be-returned'),
        counter: '0',
        device_type: 'singleDevice',
        backed_up: false,
        transports: null,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        last_used_at: null,
      });
      authService.finishPasskeyRegistration.mockResolvedValue(credential);

      const result = await controller.finishPasskeyRegistration(
        currentUser,
        dto,
      );

      expect(authService.finishPasskeyRegistration).toHaveBeenCalledWith(
        currentUser,
        dto.response,
      );
      expect(result).toEqual({
        id: 'row-1',
        credential_id: 'new-cred-id-1',
        device_type: 'singleDevice',
        backed_up: false,
        created_at: credential.created_at,
      });
      expect(result).not.toHaveProperty('public_key');
    });

    it('propagates UnauthorizedException for an invalid attestation', async () => {
      authService.finishPasskeyRegistration.mockRejectedValue(
        new UnauthorizedException('Invalid passkey registration response'),
      );

      await expect(
        controller.finishPasskeyRegistration(currentUser, dto),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('verifyWallet', () => {
    it('should return { verified: true } for a valid signature', () => {
      const dto = {
        stellar_address: 'G...Address',
        challenge: 'InsightArena:dispute:123',
        signature: 'a1b2c3d4',
      };
      authService.verifyStellarSignature.mockReturnValue(true);

      const result = controller.verifyWallet(dto);

      expect(result).toEqual({ verified: true });
      expect(authService.verifyStellarSignature).toHaveBeenCalledWith(
        dto.stellar_address,
        dto.challenge,
        dto.signature,
      );
    });

    it('should return { verified: false } for an invalid signature', () => {
      const dto = {
        stellar_address: 'G...Address',
        challenge: 'InsightArena:dispute:123',
        signature: 'wrong-signature',
      };
      authService.verifyStellarSignature.mockReturnValue(false);

      const result = controller.verifyWallet(dto);

      expect(result).toEqual({ verified: false });
    });
  });

  describe('refreshToken', () => {
    const dto = { refresh_token: 'raw-refresh-token' };

    it('should return new access token and refresh token with expiry', async () => {
      authService.rotateRefreshToken.mockResolvedValue({
        access_token: 'new.jwt.token',
        refresh_token: 'new-refresh-token',
      });

      const result = await controller.refreshToken(dto);

      expect(result.access_token).toBe('new.jwt.token');
      expect(result.refresh_token).toBe('new-refresh-token');
      expect(result.expires_at).toBeDefined();
      expect(authService.rotateRefreshToken).toHaveBeenCalledWith(
        'raw-refresh-token',
      );
    });

    it('should calculate correct expiry timestamp for 7d token', async () => {
      authService.rotateRefreshToken.mockResolvedValue({
        access_token: 'new.jwt.token',
        refresh_token: 'new-refresh-token',
      });
      configService.get.mockReturnValue('7d');

      const before = Date.now();
      const result = await controller.refreshToken(dto);
      const after = Date.now();

      const expiresAt = new Date(result.expires_at).getTime();
      const expected7Days = 7 * 24 * 60 * 60 * 1000;

      expect(expiresAt).toBeGreaterThanOrEqual(before + expected7Days);
      expect(expiresAt).toBeLessThanOrEqual(after + expected7Days);
    });

    it('should propagate UnauthorizedException if the refresh token is invalid', async () => {
      authService.rotateRefreshToken.mockRejectedValue(
        new UnauthorizedException('Invalid refresh token'),
      );

      await expect(controller.refreshToken(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should propagate UnauthorizedException on reuse detection', async () => {
      authService.rotateRefreshToken.mockRejectedValue(
        new UnauthorizedException(
          'Refresh token reuse detected; session revoked',
        ),
      );

      await expect(controller.refreshToken(dto)).rejects.toThrow(
        'Refresh token reuse detected; session revoked',
      );
    });

    it('should handle different expiry formats', async () => {
      authService.rotateRefreshToken.mockResolvedValue({
        access_token: 'new.jwt.token',
        refresh_token: 'new-refresh-token',
      });

      // Test 24h format
      configService.get.mockReturnValue('24h');
      const result24h = await controller.refreshToken(dto);
      expect(result24h.expires_at).toBeDefined();

      // Test 60m format
      configService.get.mockReturnValue('60m');
      const result60m = await controller.refreshToken(dto);
      expect(result60m.expires_at).toBeDefined();

      // Test 3600s format
      configService.get.mockReturnValue('3600s');
      const result3600s = await controller.refreshToken(dto);
      expect(result3600s.expires_at).toBeDefined();
    });
  });
});
