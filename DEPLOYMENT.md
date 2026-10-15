# FeeCore Universal — Production Deployment Guide

## 1. Prerequisites
- **Node.js**: >= 20.x
- **PostgreSQL**: >= 15.x
- **Process Manager / Container**: systemd, PM2, or Docker

---

## 2. Environment Variables

### Backend Configuration (`.env`)
Create `.env` in the backend directory or pass via process environment:

```env
# Database connection
DATABASE_URL="postgresql://<DB_USER>:<DB_PASSWORD>@<DB_HOST>:<DB_PORT>/<DB_NAME>?schema=public"

# Server configuration
PORT=4000
HOST=0.0.0.0
NODE_ENV=production

# Security & Authentication (MUST be at least 32 characters in production)
JWT_SECRET="<generate-high-entropy-64-character-secret>"
JWT_EXPIRES_IN="8h"
REFRESH_TOKEN_EXPIRES_IN="7d"

# Allowed CORS Origins (comma-separated for multiple origins)
CORS_ORIGIN="https://feecore.yourdomain.com"
```

> **Security Note**: In `production` (`NODE_ENV=production`), the backend validates `JWT_SECRET` at startup. If missing, shorter than 32 characters, or left as the development fallback placeholder, the server will refuse to start.

### Frontend Configuration (`frontend/.env.production`)
Create `frontend/.env.production` before running build:

```env
# Relative API path (if reverse-proxied under same domain) or full API URL
VITE_API_BASE_URL=/api/v1
```

---

## 3. Database Preparation & Migration

Generate Prisma client:
```bash
npm run prisma:generate
```

Apply migrations to production database:
```bash
npm run prisma:migrate:deploy
```
The repository includes the baseline migration (`prisma/migrations/20261007000000_init`). Running `prisma:migrate:deploy` safely and deterministically executes pending migrations without resetting or modifying existing production data.

---

## 4. Build Instructions

Build all workspaces (shared-types, backend NestJS app, and Vite frontend):
```bash
npm run build
```

This compiles:
- Shared types package to `packages/shared-types/dist`
- Backend application to `backend/dist`
- Frontend production bundle to `frontend/dist`

---

## 5. Running in Production

### Backend
Run directly using Node.js without dev dependencies:
```bash
npm run start:api
# Or directly:
node backend/dist/main/main.js
```

### Frontend
Serve the static files located in `frontend/dist/` via Nginx, Caddy, Cloudflare Pages, AWS S3/CloudFront, or any web server with single-page app (SPA) fallback to `index.html`.

---

## 6. Sample Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name feecore.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name feecore.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/feecore.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/feecore.yourdomain.com/privkey.pem;

    # Frontend static assets
    root /var/www/feecore/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # API Proxy
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 7. Backup & Recovery

> **Warning**: Never test restoration on the live production database. Always restore into a separate, disposable database for verification. Backups are only as reliable as your last successful restore test.

### 7.1 PostgreSQL Backup (Logical — `pg_dump`)

Create a compressed, single-transaction backup of the production database:

```bash
# Set connection variables (do not hardcode secrets in scripts)
export PGHOST="<DB_HOST>"
export PGPORT="<DB_PORT>"
export PGUSER="<DB_USER>"
export PGPASSWORD="<DB_PASSWORD>"
export PGDATABASE="<DB_NAME>"

# Backup to timestamped file
BACKUP_FILE="feecore_backup_$(date +%Y%m%d_%H%M%S).sql.gz"
pg_dump \
  --no-password \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="${BACKUP_FILE}"
```

**Storage & Protection:**
- Encrypt backup files at rest (e.g., `gpg --symmetric --cipher-algo AES256` or cloud KMS).
- Store in an off-site, access-controlled bucket (AWS S3 with SSE, GCS, Azure Blob) with versioning enabled.
- Restrict access to backup files: IAM policies allowing only designated operators/roles.
- Retention policy: Define and document your RPO (Recovery Point Objective). Example: daily backups retained 30 days, weekly 12 weeks, monthly 12 months.
- **Test restoration monthly** into a disposable database. Document the test date and outcome.

### 7.2 Restore Procedure (Verification Only)

```bash
# Create a disposable verification database
createdb -h <DB_HOST> -p <DB_PORT> -U <DB_USER> feecore_verify_$(date +%Y%m%d)

# Restore into verification database
pg_restore \
  --no-password \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname=feecore_verify_$(date +%Y%m%d) \
  <backup_file>.sql.gz

# Verify critical tables and row counts
psql -h <DB_HOST> -p <DB_PORT> -U <DB_USER> -d feecore_verify_$(date +%Y%m%d) -c "
  SELECT 'tenants' AS table_name, COUNT(*) FROM tenants
  UNION ALL SELECT 'users', COUNT(*) FROM users
  UNION ALL SELECT 'people', COUNT(*) FROM people
  UNION ALL SELECT 'payments', COUNT(*) FROM payments
  UNION ALL SELECT 'receipts', COUNT(*) FROM receipts
  UNION ALL SELECT 'financial_transaction_logs', COUNT(*) FROM financial_transaction_logs;
"

# Drop verification database after validation
dropdb -h <DB_HOST> -p <DB_PORT> -U <DB_USER> feecore_verify_$(date +%Y%m%d)
```

> **Critical**: Never run `pg_restore --clean` against the production database. The `--clean` flag drops objects before recreating them.

### 7.3 Point-in-Time Recovery (PITR / WAL Archiving)

PITR is an **infrastructure-dependent capability**, not provided by the application. It requires:

- PostgreSQL `wal_level = replica` (or `logical`).
- `archive_mode = on` with a valid `archive_command` shipping WAL segments to durable, off-site storage (e.g., `aws s3 cp`, `gsutil cp`, or `scp` to a standby server).
- A base backup taken with `pg_basebackup`.
- A recovery target (timestamp, LSN, or transaction ID) defined in `recovery.signal` / `recovery.conf`.

If your managed PostgreSQL service (RDS, Cloud SQL, Azure Database, Neon, etc.) offers PITR, use that service's documented restore workflow. Do not assume PITR exists unless you have explicitly configured and tested it.

### 7.4 RPO / RTO

| Metric | Definition | Default (Choose Explicitly) |
|--------|------------|------------------------------|
| **RPO** | Maximum acceptable data loss (time between backups) | **Operator-defined**. Example: 24h (daily `pg_dump`), 5m (PITR with WAL archiving). |
| **RTO** | Maximum acceptable downtime to restore service | **Operator-defined**. Example: 2h (restore from `pg_dump`), 15m (promote PITR replica). |

**Do not use defaults.** Record your chosen RPO/RTO in your runbook and obtain stakeholder sign-off.

---

## 8. Application Rollback

> **Principle**: Rolling back application code does not roll back the database schema. If a migration was applied, the schema remains at the new version. Only revert code if the new schema is backward-compatible with the old code, or if you have a verified plan to handle the schema mismatch.

### 8.1 Code Rollback (Git-based)

```bash
# 1. Identify the last known-good release tag or commit
git tag --list "v*" --sort=-v:refname | head -5

# 2. Check out the target release
git checkout v<LAST_GOOD_VERSION>  # or git checkout <COMMIT_SHA>

# 3. Rebuild all workspaces
npm run build

# 4. Verify environment variables are correct for the rolled-back version
#    (Check .env against backend/.env.example for any new/removed vars)

# 5. Restart backend process
npm run start:api
# Or via process manager:
# pm2 restart feecore-api
# systemctl restart feecore-api

# 6. Verify service health
curl -f http://localhost:4000/api/v1/health  # If health endpoint added
# Or check process manager logs: pm2 logs feecore-api
```

### 8.2 Pre-Restart Checks

| Check | Command |
|-------|---------|
| Build succeeds | `npm run build` (exit code 0) |
| Prisma client generated | `npm run prisma:generate` |
| No pending migrations (code matches DB) | `npx prisma migrate status` |
| Environment variables valid | Compare `.env` with `backend/.env.example` |
| Frontend assets built | `ls frontend/dist/` |

### 8.3 Post-Rollback Verification

1. **API responds**: `curl -f http://localhost:4000/api/v1/tenants/<TENANT_ID>/people?limit=1` (requires valid JWT).
2. **Logs show no startup errors**: Check `npm run start:api` output or process manager logs.
3. **Frontend loads**: Open the domain; verify login page renders.
4. **Smoke test**: Log in as admin; verify dashboard loads; verify a read-only API call succeeds.

### 8.4 Schema Rollback Warning

**Do not assume** reverting application code makes the database compatible. If `prisma:migrate:deploy` applied a migration that added columns, tables, or constraints, the old code may:
- Fail to start (missing columns expected by old Prisma client).
- Write invalid data (new constraints violated).
- Leak data (new tables not handled by old code).

**Safe schema rollback requires a separate, deliberate migration** (see Section 9). If the migration is not backward-compatible, you must either:
- Keep the new code deployed, or
- Plan a coordinated schema rollback with data migration, accepting downtime.

---

## 9. Migration Failure & Recovery

### 9.1 Prisma Migration Setup (Reference)

| Item | Value |
|------|-------|
| Prisma version | 5.14.0 |
| Migration command | `npm run prisma:migrate:deploy` (runs `prisma migrate deploy`) |
| Baseline migration | `prisma/migrations/20261007000000_init` |
| Migration table | `_prisma_migrations` |

### 9.2 Failure Scenarios & Decision Steps

| Scenario | Immediate Action |
|----------|------------------|
| **Migration fails mid-way (SQL error)** | **STOP**. Do not re-run `migrate deploy`. The database is in an undefined state. |
| **Migration succeeds but app fails to start** | Check application logs. If schema change is backward-incompatible, see 8.4. |
| **Migration timeout / lock contention** | Check for long-running transactions (`SELECT * FROM pg_stat_activity WHERE state = 'active'`). Resolve contention, then retry `migrate deploy`. |
| **Drift detected (schema != migration history)** | Run `prisma migrate diff` to inspect. Do not `prisma db push` in production. |

### 9.3 Safe Recovery Steps

1. **Assess the failure**: Read the exact error from `prisma migrate deploy` output.
2. **Inspect database state**:
   ```bash
   npx prisma migrate status
   # Shows: applied migrations, pending migrations, drift
   ```
3. **If migration partially applied and failed**:
   - The `_prisma_migrations` table records the migration as `FAILED`.
   - **Do not** run `prisma migrate resolve --rolled-back` unless you have:
     - Manually inspected the failed migration's SQL.
     - Confirmed the partial changes are either harmless or manually reverted.
     - Verified no data corruption in financial tables (`payments`, `receipts`, `financial_transaction_logs`, `dues`, `payment_allocations`).
   - If unsure: **Escalate**. Restore from the last verified backup (Section 7.2) into a new database, point the application to it, and investigate offline.
4. **If migration applied but causes runtime errors**:
   - The migration is marked `SUCCESS` in `_prisma_migrations`.
   - Option A: Roll back application code (Section 8) if the change is backward-compatible.
   - Option B: Create a **new compensating migration** to revert the problematic change:
     ```bash
     npx prisma migrate dev --name revert_<problematic_migration>
     # Edit the generated migration file to DROP/ALTER back safely
     npx prisma migrate deploy
     ```
   - Option C: If data integrity is at risk, **stop and escalate**. Do not guess.

### 9.4 `prisma migrate resolve --rolled-back` — When (and When Not) to Use

| Use Case | Appropriate? |
|----------|--------------|
| Migration failed, you manually fixed the DB to match the pre-migration state, and you want Prisma to mark it as "not applied" | ✅ Yes — only after manual verification |
| Migration succeeded but you want to "undo" it without writing a down migration | ❌ No — this lies to Prisma about the DB state |
| You restored a database snapshot from before the migration | ❌ No — the `_prisma_migrations` table in the restored DB already reflects pre-migration state; just reconnect the app |
| You are unsure what the migration did | ❌ No — escalate instead |

**Command (only after verification):**
```bash
npx prisma migrate resolve --rolled-back "<migration_name>"
```

### 9.5 Financial Data Protection — Escalation Triggers

**Stop and escalate immediately if any migration failure involves:**
- `payments`, `payment_allocations`, `receipts`, `financial_transaction_logs`, `refunds`, `dues` tables.
- Unique constraint violations on `payments.idempotency_key` or `receipts.receipt_number`.
- Data truncation or type conversion errors on `BigInt` monetary columns.

These tables are the immutable financial ledger. Guessing at recovery risks non-repudiation and audit compliance. Restore from backup (Section 7.2) and investigate offline.
