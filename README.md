# FeeCore Universal

FeeCore Universal is a multi-tenant, enterprise-grade financial engine engineered for universal fee, charge, and collection workflows across education, healthcare, real estate, and subscription services.

---

## Architecture & Directory Structure

```text
FeeCore/
├── backend/                   # NestJS API application (Fastify, Prisma ORM)
│   ├── prisma/                # Prisma schema & SQL baseline migrations
│   │   ├── migrations/        # Immutable database migrations
│   │   └── schema.prisma      # Schema definition
│   ├── src/                   # NestJS modules, domain logic & ledger services
│   └── test/                  # Test suites (Vitest)
├── frontend/                  # React 18 SPA (TypeScript, Vite, Vanilla CSS)
│   ├── src/                   # React components, contexts, hooks & layout
│   └── index.html             # Single-page application entrypoint
├── packages/
│   └── shared-types/          # Shared TypeScript domain contracts & types
├── docs/                      # Architectural specifications & business requirements
│   ├── FeeCore_Universal_Business_Requirements_SRS_v2.docx
│   ├── architecture-review.md
│   ├── business-rules.md
│   ├── development-roadmap.md
│   ├── edge-cases.md
│   ├── implementation-plan.md
│   ├── permission-matrix.md
│   ├── requirements-traceability.md
│   ├── state-models.md
│   └── technical-decisions.md
├── scripts/                   # Zero-dependency development and utility scripts
├── DEPLOYMENT.md              # Production deployment & operations guide
├── package.json               # Root monorepo workspace configuration
└── tsconfig.base.json         # Base TypeScript configuration
```

---

## Prerequisites

- **Node.js**: >= 20.x
- **npm**: >= 10.x
- **PostgreSQL**: >= 15.x

---

## Environment Setup

1. **Root / Backend Configuration (`.env`)**:
   Copy `.env.example` to `.env` in the root (and in `backend/` if running standalone):
   ```bash
   cp .env.example .env
   ```
   Configure the database connection:
   ```env
   DATABASE_URL="postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/feecore?schema=public"
   PORT=4000
   HOST=0.0.0.0
   NODE_ENV=development
   JWT_SECRET="<generate-high-entropy-secret-minimum-32-chars>"
   JWT_EXPIRES_IN="15m"
   REFRESH_TOKEN_EXPIRES_IN="7d"
   CORS_ORIGIN="http://localhost:5180,http://localhost:5173"
   ```

2. **Frontend Configuration (`frontend/.env`)**:
   Copy `frontend/.env.example` to `frontend/.env`:
   ```env
   VITE_API_BASE_URL=/api/v1
   VITE_BACKEND_URL=http://localhost:4000
   ```

3. **Prisma Client Generation & Database Migrations**:
   ```bash
   npm run prisma:generate
   npm run prisma:migrate:deploy
   ```

---

## Local Development Commands

| Command | Working Directory | Description |
|---|---|---|
| `npm run dev` | Project Root | Starts both Backend API (port 4000) and Frontend (port 5180) concurrently |
| `npm run dev:api` | Project Root | Starts Backend API in watch mode (`http://localhost:4000`) |
| `npm run dev:web` | Project Root | Starts Frontend Vite dev server (`http://localhost:5180`) |
| `npm run dev` | `backend/` | Starts Backend API in watch mode from `backend` directory |
| `npm run dev` | `frontend/` | Starts Frontend Vite dev server from `frontend` directory |
| `npm run build` | Project Root | Compiles all packages (shared-types, backend, and frontend) |
| `npm run seed:demo` | Project Root | Seeds idempotent demo accounts (Admin, Collector, Viewer) |
| `npm run test` | Project Root | Runs test suites across all workspaces |
| `npm run start:api` | Project Root | Starts compiled production Backend API (`node backend/dist/main/main.js`) |

---

## Demo Accounts

For pre-configured development credentials across all system roles (`ROLE_ADMIN`, `ROLE_COLLECTOR`, `ROLE_VIEWER`), see [DEMO_ACCOUNTS.md](file:///c:/Users/shant/OneDrive/Desktop/FeeCore/DEMO_ACCOUNTS.md).

---

## Health & Status Check

- Backend Health: `GET http://localhost:4000/api/v1/health`
- Backend Readiness: `GET http://localhost:4000/api/v1/health/ready`
- Frontend UI: `http://localhost:5180`
