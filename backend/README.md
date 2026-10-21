# InsightArena — Backend

NestJS REST API powering the InsightArena prediction market platform. Handles authentication, market management, predictions, leaderboards, competitions, analytics, and Soroban contract orchestration on the Stellar network.

---

## Tech Stack

| Layer           | Technology            |
| --------------- | --------------------- |
| Framework       | NestJS 11             |
| Language        | TypeScript 5          |
| Database        | PostgreSQL + TypeORM  |
| Auth            | JWT + Passport        |
| Blockchain      | Stellar SDK + Soroban |
| Package Manager | pnpm 9                |
| Testing         | Jest                  |
| Docs            | Swagger / OpenAPI     |

---

## Prerequisites

- Node.js 20+
- pnpm 9 — `npm install -g pnpm`
- PostgreSQL (local or Docker)
- Make

---

## Getting Started

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your DB credentials and secrets

# 3. Run database migrations
pnpm run migration:run

# 4. Start in development mode
pnpm run start:dev
```

API base URL: `http://localhost:3000/api/v1`  
Swagger UI: `http://localhost:3000/api/v1/docs`  
OpenAPI JSON: `http://localhost:3000/api/v1/docs-json`

---

## Local Dev with Docker

For a one-command setup with no local Node/pnpm/Postgres install, run:

```bash
docker compose up
```

This builds the API image and starts it alongside a Postgres 16 container, using the
default local-dev values baked into `docker-compose.yml` (no `.env` file needed). Once
both containers report healthy, the API is up at `http://localhost:3000/api/v1` and
Swagger UI at `http://localhost:3000/api/v1/docs`.

Run in the background with `docker compose up -d`, and tear it down (including the
Postgres volume) with `docker compose down -v`.

Database migrations are not run automatically. After the containers are up, apply them
from the host with:

```bash
DATABASE_URL=postgresql://stow:stow@localhost:5432/stow pnpm run migration:run
```

---

## Environment Variables

| Variable              | Description                       |
| --------------------- | --------------------------------- |
| `DATABASE_URL`        | PostgreSQL connection string      |
| `JWT_SECRET`          | JWT signing secret (min 32 chars) |
| `JWT_EXPIRES_IN`      | Token expiry e.g. `7d`            |
| `STELLAR_NETWORK`     | `testnet` or `mainnet`            |
| `SOROBAN_CONTRACT_ID` | Deployed contract ID              |
| `PORT`                | Server port (default `3000`)      |
| `FRONTEND_URL`        | Default allowed browser origin    |
| `CORS_ORIGINS`        | Optional comma-separated browser origin allowlist; overrides `FRONTEND_URL` |

CORS allows credentialed requests from the configured origins. The Nest/Express
CORS middleware answers preflight `OPTIONS` requests and permits the API's
authorization, API key, content type, and idempotency headers. Do not set an
origin to `*` while credentials are enabled.

---

## Scripts

```bash
pnpm run start:dev     # Development with watch mode
pnpm run start:prod    # Production
pnpm run build         # Compile TypeScript
pnpm run lint          # Run ESLint (auto-fix)
pnpm run test          # Run unit tests
pnpm run test:cov      # Run tests with coverage
pnpm run test:e2e      # Run end-to-end tests
pnpm run format        # Format with Prettier
```

---

## Database Migrations

```bash
# Run all pending migrations
pnpm run migration:run

# Generate a new migration from entity changes
pnpm run migration:generate -- src/migrations/MigrationName

# Revert the last migration
pnpm run migration:revert
```

---

## Project Structure

```
src/
├── auth/           # JWT authentication and wallet verification
├── users/          # User profiles and management
├── markets/        # Prediction market CRUD and lifecycle
├── predictions/    # Prediction submission and resolution
├── leaderboard/    # Rankings and scoring
├── competitions/   # Competition management
├── analytics/      # Platform analytics and history
├── achievements/   # User achievement tracking
├── admin/          # Admin controls and moderation
├── health/         # Health check endpoint
├── common/         # Guards, decorators, interceptors, filters
└── config/         # Environment validation and TypeORM config
```

---

## Health Check

```bash
curl http://localhost:3000/api/v1/health
```

Returns `200 OK` when the service, database, and disk are healthy. Returns `503` otherwise.

Container orchestrators can use separate probes:

```bash
curl http://localhost:3000/api/v1/health/live
curl http://localhost:3000/api/v1/health/ready
curl http://localhost:3000/api/v1/health/dependencies
```

`/health/live` only verifies that the process is responding. `/health/ready`
checks PostgreSQL, the critical dependency for serving API requests, and returns
`503` when it is unavailable. `/health/dependencies` reports status and latency
for PostgreSQL, Soroban RPC, the cache, and the indexer; non-critical dependency
failures are reported as degraded without failing readiness.

## Social Sign-In

Google, Apple, and GitHub sign-in are optional. Configure provider credentials
in the backend environment and register this callback URL with each provider:
`https://<your-api-host>/api/v1/auth/oauth/callback`. Set `FRONTEND_URL` to the
frontend origin and `OAUTH_CALLBACK_URL` to that exact registered callback.
Apple also requires its Services ID, Team ID, Key ID, and `.p8` private key;
write private-key line breaks as `\n` in the environment.

Run the database migration before enabling these providers:

```bash
pnpm run migration:run
```

Social identities are never automatically matched by email. A user must first
sign in with their Stellar wallet or passkey and link each provider from
**Settings**. OAuth state is single-use and persisted; the callback returns a
short-lived, single-use exchange code rather than putting session tokens in the
redirect URL. The code exchange is bound to a random verifier retained only in
the initiating browser tab, protecting sign-in from copied callback URLs. Set
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`,
`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, or the corresponding Apple
settings to expose each provider.

---

## CI

Before committing, run the full pipeline locally:

```bash
make ci
```

This runs lint → test → build in sequence. See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for the full guide.

---

## Contributing

See [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md).
