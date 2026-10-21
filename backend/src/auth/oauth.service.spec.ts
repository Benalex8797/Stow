import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { OAuthIdentity } from './entities/oauth-identity.entity';
import { OAuthTransaction } from './entities/oauth-transaction.entity';
import { OAuthService } from './oauth.service';

describe('OAuthService', () => {
  let service: OAuthService;
  let users: {
    findOneBy: jest.Mock;
  };
  let identities: {
    create: jest.Mock;
    find: jest.Mock;
    findOneBy: jest.Mock;
    save: jest.Mock;
  };
  let transactions: {
    create: jest.Mock;
    delete: jest.Mock;
    findOneBy: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let authService: {
    createSession: jest.Mock;
  };
  const config = {
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    FRONTEND_URL: 'https://stow.example',
    OAUTH_CALLBACK_URL: 'https://api.stow.example/api/v1/auth/oauth/callback',
  };
  const clientVerifier = 'a'.repeat(64);

  beforeEach(async () => {
    users = { findOneBy: jest.fn() };
    identities = {
      create: jest.fn((value: Partial<OAuthIdentity>) =>
        Object.assign(new OAuthIdentity(), value),
      ),
      find: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn(),
    };
    transactions = {
      create: jest.fn((value: Partial<OAuthTransaction>) =>
        Object.assign(new OAuthTransaction(), value),
      ),
      delete: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn((value: OAuthTransaction) => Promise.resolve(value)),
      update: jest.fn(),
    };
    authService = { createSession: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => config[key as keyof typeof config]),
          },
        },
        { provide: AuthService, useValue: authService },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(OAuthIdentity), useValue: identities },
        {
          provide: getRepositoryToken(OAuthTransaction),
          useValue: transactions,
        },
      ],
    }).compile();

    service = module.get(OAuthService);
  });

  it('starts Google login with a stored one-time state and safe return path', async () => {
    const authorizationUrl = await service.beginLogin(
      'google',
      clientVerifier,
      '//attacker.example',
    );
    const url = new URL(authorizationUrl);
    const savedTransaction = transactions.create.mock.calls[0][0];

    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('google-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      config.OAUTH_CALLBACK_URL,
    );
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(savedTransaction.state_hash).not.toBe(url.searchParams.get('state'));
    expect(savedTransaction.client_verifier_hash).toBe(
      createHash('sha256').update(clientVerifier).digest('hex'),
    );
    expect(savedTransaction.return_to).toBe('/savings');
    expect(transactions.save).toHaveBeenCalledTimes(1);
  });

  it('rejects unconfigured providers without starting an OAuth transaction', async () => {
    await expect(service.beginLogin('github', clientVerifier)).rejects.toThrow(
      'github sign-in is not configured',
    );
    expect(transactions.save).not.toHaveBeenCalled();
  });

  it('resolves a provider from callback state rather than an untrusted query value', async () => {
    const state = 'callback-state';
    transactions.findOneBy.mockResolvedValue({
      provider: 'github',
      consumed_at: null,
      expires_at: new Date(Date.now() + 60_000),
    });

    await expect(service.providerForState(state)).resolves.toBe('github');
    expect(transactions.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        state_hash: createHash('sha256').update(state).digest('hex'),
      }),
    );
  });

  it('links a provider subject only to the wallet account that started linking', async () => {
    const state = 'link-state';
    const transaction = Object.assign(new OAuthTransaction(), {
      id: 'oauth-transaction',
      state_hash: createHash('sha256').update(state).digest('hex'),
      provider: 'google',
      intent: 'link' as const,
      user_id: 'wallet-user',
      nonce: null,
      expires_at: new Date(Date.now() + 60_000),
      consumed_at: null,
      return_to: '/settings',
    });
    users.findOneBy.mockResolvedValue({ id: 'wallet-user' });
    transactions.findOneBy.mockResolvedValue(transaction);
    transactions.update.mockResolvedValue({ affected: 1 });
    identities.findOneBy.mockResolvedValue(null);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'provider-access-token' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            sub: 'google-subject',
            email: 'user@example.com',
            email_verified: true,
            name: 'User',
          }),
      } as Response);

    const redirectUrl = await service.completeCallback(
      'google',
      state,
      'provider-code',
    );

    expect(new URL(redirectUrl).pathname).toBe('/settings');
    expect(new URL(redirectUrl).searchParams.get('oauth_linked')).toBe('1');
    expect(identities.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'wallet-user',
        provider: 'google',
        provider_user_id: 'google-subject',
        email: 'user@example.com',
      }),
    );
  });

  it('does not link a provider identity to a different Stow account', async () => {
    const state = 'single-use-state';
    const transaction = {
      id: 'oauth-transaction',
      state_hash: createHash('sha256').update(state).digest('hex'),
      provider: 'google',
      intent: 'link',
      user_id: 'wallet-user',
      nonce: null,
      expires_at: new Date(Date.now() + 60_000),
      consumed_at: null,
      return_to: '/settings',
    };
    transactions.findOneBy.mockResolvedValue(transaction);
    transactions.update.mockResolvedValue({ affected: 1 });
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'provider-access-token' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            sub: 'google-subject',
            email: 'user@example.com',
            email_verified: true,
            name: 'User',
          }),
      } as Response);
    users.findOneBy.mockResolvedValue({ id: 'wallet-user' });
    identities.findOneBy.mockResolvedValue({
      user_id: 'other-user',
      provider: 'google',
      provider_user_id: 'google-subject',
    });

    await expect(
      service.completeCallback('google', state, 'provider-code'),
    ).rejects.toThrow('already linked to another Stow account');
    expect(identities.save).not.toHaveBeenCalled();
  });

  it('exchanges a single-use grant for a Stow session', async () => {
    const transaction = {
      id: 'oauth-transaction',
      user_id: 'wallet-user',
      client_verifier_hash: createHash('sha256')
        .update(clientVerifier)
        .digest('hex'),
      expires_at: new Date(Date.now() + 60_000),
      exchanged_at: null,
    };
    const user = Object.assign(new User(), {
      id: 'wallet-user',
      stellar_address: 'GABC',
    });
    transactions.findOneBy.mockResolvedValue(transaction);
    transactions.update.mockResolvedValue({ affected: 1 });
    users.findOneBy.mockResolvedValue(user);
    authService.createSession.mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    });

    const result = await service.exchangeCode(
      'single-use-code',
      clientVerifier,
    );

    expect(result).toEqual({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      user,
    });
    expect(authService.createSession).toHaveBeenCalledWith(user);
    expect(transactions.update).toHaveBeenCalledTimes(1);
  });

  it('does not consume an exchange code with the wrong browser verifier', async () => {
    transactions.findOneBy.mockResolvedValue({
      id: 'oauth-transaction',
      user_id: 'wallet-user',
      client_verifier_hash: createHash('sha256')
        .update(clientVerifier)
        .digest('hex'),
      expires_at: new Date(Date.now() + 60_000),
      exchanged_at: null,
    });

    await expect(
      service.exchangeCode('single-use-code', 'b'.repeat(64)),
    ).rejects.toThrow('OAuth exchange code is invalid or expired');
    expect(transactions.update).not.toHaveBeenCalled();
    expect(authService.createSession).not.toHaveBeenCalled();
  });
});
