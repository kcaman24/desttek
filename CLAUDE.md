# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**DESTTEK** is a Dockerized knowledge base platform (Turkish-first) built with Node.js + Express + SQLite (better-sqlite3). It exposes a read-only public frontend, an admin CRUD panel, and a REST API — all served from a single Express process.

## Commands

### Local development (Docker — preferred)

```bash
# First-time setup
cd backend && cp .env.example .env
# Generate JWT_SECRET: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# Set ADMIN_USERNAME, ADMIN_PASSWORD, ALLOWED_ORIGINS in .env

# From project root:
docker-compose up -d
docker-compose logs -f

# Rebuild after dependency changes:
docker-compose up -d --build
```

### Local development (without Docker)

```bash
cd backend
npm install
npm run dev   # nodemon watch mode
# npm start   # production mode
```

### Access points

| URL | Purpose |
|-----|---------|
| `http://localhost:3000` | Public knowledge base |
| `http://localhost:3000/panel` | Admin panel |
| `http://localhost:3000/health` | Health check (JSON) |

No test suite or linter is configured in this project.

## Architecture

```
desttek/
├── backend/src/
│   ├── index.js          # Express app init, middleware stack, route registration
│   ├── db.js             # DB init, schema, all prepared statements, transactions
│   ├── routes/
│   │   ├── api.js        # Public read-only API (/api/...)
│   │   └── admin.js      # Authenticated CRUD + backup/import/export (/admin/...)
│   └── middleware/
│       ├── auth.js       # JWT Bearer verification (HS256, 8h, issuer: 'desttek')
│       ├── audit.js      # Logs every admin mutation to audit_log table
│       └── validate.js   # express-validator rules for all inputs
├── frontend/index.html   # Public site — vanilla JS, no build step
├── admin/index.html      # Admin panel — vanilla JS, no build step
└── docker-compose.yml    # Full stack (multi-stage build, Alpine, non-root)
```

### Data model

Five SQLite tables:

- `categories` — top-level knowledge base sections
- `records` — entries within a category (ordered by `position`)
- `fields` — flexible key-value pairs within a record (ordered by `position`)
- `admin_users` — credentials (bcrypt cost 12)
- `audit_log` — append-only log of all admin mutations

All DB access goes through prepared statements in `db.js`; no raw string queries anywhere.

### Request lifecycle (admin write)

1. Rate limiter (50 ops / 15 min) → `auth.js` JWT check → `validate.js` rules
2. Route handler in `admin.js` executes prepared statement(s) in `db.js`
3. `audit.js` middleware logs the action (admin_id, IP, User-Agent, target UUID)
4. JSON response → frontend JS updates UI

### Rate limiting tiers

| Tier | Limit |
|------|-------|
| Public API | 200 req / 15 min |
| Admin ops | 50 req / 15 min |
| Login | 10 req / 15 min |

### Environment variables

All configuration comes from `backend/.env` (see `backend/.env.example`). Key vars:

- `JWT_SECRET` — must be a 64-char random hex string in production
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — seeded into `admin_users` at startup
- `ALLOWED_ORIGINS` — comma-separated CORS whitelist
- `DB_PATH` — defaults to `./data/desttek.db`

### Frontend architecture

Both `frontend/index.html` and `admin/index.html` are single-file apps with embedded CSS and JS — no bundler, no framework. They communicate with the backend exclusively via the REST API. The admin panel stores the JWT in `localStorage` and sends it as `Authorization: Bearer <token>`.

## Deployment (Render.com)

Push to GitHub; create a **Web Service** pointing to the repo. Set build command to `docker build` or use the `docker-compose.yml`. All required env vars must be added in the Render dashboard. The `desttek_data` Docker volume persists the SQLite file across deploys.
