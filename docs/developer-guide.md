# Developer Guide

## Project Structure

```
PocketCloud/
├── index.html              # Single-page frontend shell
├── app.js                  # Frontend JS (vanilla, no framework)
├── styles.css              # Design system (CSS variables, forest-green theme)
├── apps/
│   └── api/
│       ├── src/
│       │   ├── server.ts         # Fastify HTTP server (all API endpoints)
│       │   ├── worker.ts         # Task queue consumer process
│       │   ├── scheduler.ts      # Cron jobs (offline detection, cleanup)
│       │   ├── task-engine.ts    # Task reconciliation (timeout, offline auto-fail)
│       │   ├── agent-registry.ts # Agent binary serving
│       │   ├── security.ts       # Argon2id, JOSE JWT, crypto helpers
│       │   └── config.ts         # Zod-validated environment config
│       ├── prisma/
│       │   └── schema.prisma     # Database schema (13 models)
│       └── package.json
├── packages/
│   └── blueprint/
│       └── index.ts              # Blueprint engine (sanitize, validate, compat)
├── agent/
│   ├── cmd/pocketcloud-agent/
│   │   └── main.go               # Go agent (telemetry + task execution)
│   ├── install-agent.sh          # One-line VPS agent installer
│   └── go.mod
├── deploy/
│   ├── docker-compose.yml        # Production container orchestration
│   ├── Caddyfile                 # Caddy reverse proxy config
│   ├── Dockerfile.api            # API container image
│   └── .env.example
├── scripts/
│   └── install.sh                # Control plane one-line installer
├── docs/                         # Operator and developer documentation
├── tests/                        # Vitest unit and integration tests
└── .github/workflows/
    └── ci.yml                    # GitHub Actions CI pipeline
```

## Local Development Setup

### Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL 16+ (or Docker)
- Go 1.22+ (for agent development only)

### Start the Database

```bash
docker run -d --name pocketcloud-pg \
  -e POSTGRES_USER=pocketcloud \
  -e POSTGRES_PASSWORD=pocketcloud \
  -e POSTGRES_DB=pocketcloud \
  -p 5432:5432 postgres:16-alpine
```

### Configure Environment

```bash
cp .env.example .env
# DATABASE_URL is already set to the local Postgres defaults
```

### Install Dependencies

```bash
npm install
```

### Run Migrations

```bash
cd apps/api && npx prisma migrate dev --name init
```

### Start the API

```bash
npm run dev -w @pocketcloud/api
# or: cd apps/api && npx tsx watch src/server.ts
```

### Start Worker Processes (optional, for full task testing)

```bash
cd apps/api
npx tsx src/worker.ts &
npx tsx src/scheduler.ts &
npx tsx src/task-engine.ts &
```

### Serve the Frontend

```bash
npx -y serve -p 3000 .
# or open index.html in a browser directly
```

## Running Tests

```bash
npm test                    # Run all tests
npm test -- --coverage      # With coverage report
npm run test -w @pocketcloud/api  # API tests only
```

Tests are in `tests/` and use Vitest with a real in-memory SQLite database (via Prisma datasource override).

## Building for Production

```bash
npm run build               # TypeScript compile for all workspaces
npm run build -w @pocketcloud/api  # API only
```

Output: `apps/api/dist/`

## Building the Go Agent

```bash
cd agent

# Linux x86_64
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" \
  -o ../dist/pocketcloud-agent-linux-x86_64 \
  ./cmd/pocketcloud-agent

# Linux ARM64
GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" \
  -o ../dist/pocketcloud-agent-linux-aarch64 \
  ./cmd/pocketcloud-agent
```

## Code Style

### TypeScript

- ESLint: `npm run lint -w @pocketcloud/api`
- Prettier: `npm run format:check -w @pocketcloud/api`
- Types: all `any` casts require a comment explaining why

### Frontend JavaScript

- No framework, no bundler — vanilla ES2020+
- All DOM manipulation via `document.getElementById`
- Lucide icons via CDN — call `refreshIcons()` after any DOM update
- `escHtml()` required for all user-provided string interpolation in innerHTML

### Go

- `gofmt` for formatting
- `go vet` for static analysis
- All exec commands use `context.WithTimeout` (5-minute max)

## Adding a New API Endpoint

1. Add the route in `apps/api/src/server.ts`
2. Use `z.object({...}).parse(req.body)` for input validation (Zod throws on invalid input, caught by `setErrorHandler`)
3. Add `include:` clauses to Prisma queries to avoid N+1 fetches
4. Update `docs/api.md` with the new endpoint

## Adding a New Task Type

1. Add the type string to the `z.enum([...])` in `POST /api/v1/tasks`
2. Add an `executorHandler` case in `agent/cmd/pocketcloud-agent/main.go` `executeTask()`
3. Update the allowed task list in `docs/agent-guide.md`
4. Add a dispatch button in `index.html` if user-facing

## Adding a New Blueprint Field

1. Update the Zod schema in `packages/blueprint/index.ts`
2. Update `sanitizeEnvironment()` if the field might contain secrets
3. Update `validateCompatibility()` if the field affects OS/arch compat
4. Update `docs/blueprint-spec.md`

## Database Migrations

```bash
# Create a new migration
cd apps/api
npx prisma migrate dev --name add_your_field

# Apply migrations in production
npx prisma migrate deploy

# Reset (DESTROYS ALL DATA)
npx prisma migrate reset
```

Never edit migration files after they have been committed. Create a new migration instead.
