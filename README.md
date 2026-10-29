# Raw2Reel

AI-powered short-form video editing co-pilot for Instagram Reels and TikTok creators.
Upload a raw media dump and get a beat-synced, captioned 9:16 reel ready to publish.

- **Muse Spark** — script analysis and automated editing workflow
- **Muse Vision** — visual highlight and face detection
- **Muse Voice Transcribe** — real-time captions and voiceover

## Repository layout

```
raw2reel/
├── frontend/   # React + TypeScript + Vite web app (Feature-Sliced Design)
├── backend/    # Bun HTTP API: Cosmos (Mongo API) + Blob Storage
├── ai/         # Python FastAPI: Muse pipeline orchestration, image preprocessing
└── infra/      # Caddy routing, compose for the apps, CI deploy scripts
```

Each app is self-contained: its own dependencies, scripts, linters and README.

- [frontend](frontend/) — React 19, TypeScript, Vite 8, pnpm.
  Docs: [frontend/README.md](frontend/README.md)
- [backend](backend/) — Bun, TypeScript. Talks to Cosmos DB over the MongoDB API
  and to Azure Blob Storage.
- [ai](ai/) — Python 3.12, FastAPI, uv. Served under `/ml/*`. Orchestrates the
  external Muse pipelines and preprocesses images; holds no local models.
- [infra](infra/) — deployment and CI. Docs: [infra/README.md](infra/README.md)

## Quick start

```bash
cd frontend
nvm use
corepack enable
pnpm install
pnpm dev
```

Then open http://localhost:5173. Full setup, scripts and troubleshooting are in
[frontend/README.md](frontend/README.md).

## Conventions

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) with the app as
  scope when it helps, e.g. `feat(frontend): …`, `fix(backend): …`.
- Keep app-specific config (linters, formatters, `.nvmrc`, lockfiles) inside the app directory.
- Environment variables are documented in [.env.example](.env.example) — keys and
  descriptions only, never values.

## Routing

- `/` — frontend
- `/api/*` — backend
- `/ml/*` — ML service
- `/git/` — Gitea (git hosting and CI), served under a subpath so it needs no
  DNS record of its own

Backend and ML expose `/health`, `/ready` and `/version`. `/version` returns the
commit sha baked into the image at build time, so it changes on every deploy.

## CI/CD

Push to `main` here on GitHub. A poller on the deployment host carries the commit
to a Gitea instance running next to the apps, and Gitea Actions build and deploy
it — only the projects the change touched. Expect up to two minutes before the
pipeline starts.

GitHub Actions is not used: the deployment host cannot be reached from
GitHub-hosted runners without repository admin rights. Pull request checks
therefore do not run — see [infra/README.md](infra/README.md) for the pipeline,
rollback behaviour and the known trade-offs.

### API reference (AVI-341)

Swagger UI: `/api/docs` (also `/api/docs/`). Machine-readable OpenAPI 3.1:
`/api/openapi.json`. Direct backend URLs are `/docs` and `/openapi.json`:
Caddy removes `/api` once. The spec uses a relative server URL so both forms
resolve correctly. Swagger assets are served locally; no CDN or external validator
receives the specification. Try it out is disabled, credentials are not persisted.

The reference covers media, health/readiness/version, the authenticated
`GET /api/db/hello` diagnostic (it **writes an upsert**), Better Auth session
introspection/sign-out, and both identity transports. Session schemas are generated
from Better Auth 1.7.14 with the actual auth configuration and an in-memory adapter:
`cd backend && bun scripts/auth-schema.ts`. `bun test` validates OpenAPI and detects
stale generated schemas. Generator endpoints are enabled only in this offline tool.

For a non-browser API client:

1. POST `/api/identity/api/guest` with JSON `{}`, or `/api/identity/api/sign-in`
   with `email` and `password`. Send neither Origin nor Cookie headers. Keep the
   returned access/refresh values private; do not print them into logs.
2. Send `Authorization: Bearer <accessToken>` to POST `/api/media` with multipart
   field `file`, GET `/api/media?limit=20`, and GET `/api/media/{id}`. MIME defaults
   are video/*, image/* and audio/*; file size defaults to 100 MiB, configurable.
3. POST `/api/identity/activity` with the access bearer for explicit user activity.
4. POST `/api/identity/api/refresh` with JSON `refreshToken`; replace the previous
   pair atomically. Access defaults to 15 minutes; family expiry is absolute at
   30 days. Refresh reuse revokes the family, and background refresh is not activity.
5. Register a guest through `/api/identity/api/sign-up` with guest access bearer
   and exactly `email`, `password`, `name`, `mode: "upgrade"`. Retry the same input
   after a lost response for bounded recovery. `mode: "new"` is a distinct flow;
   missing/invalid upgrade proof never silently creates a new identity.
6. POST `/api/identity/api/logout` with JSON `refreshToken` to revoke that family,
   or `/api/identity/revoke-all` with an access bearer to revoke all families.
   Logout does not delete data.

For web clients use the matching `/api/identity/web/*` routes with an allowed
Origin. Guest/sign-in/sign-up issue a Better Auth session cookie and HttpOnly,
Secure, SameSite=Lax `__Host-r2r-refresh`; refresh never appears in web JSON.
POST `/api/identity/web/csrf` with `{}` to obtain a CSRF value, then supply it as
`X-CSRF-Token` for refresh, logout and guest upgrade. Bootstrap it again after
refresh rotation. Web refresh/logout bodies are `{}`. Use HTTPS locally for
Secure cookies. Media supports the bound session cookie **or** access bearer;
mixing Cookie and Authorization is rejected. Raw Better Auth email routes do not
replace identity issuance and cannot by themselves establish media authority.

Isolation check in an isolated environment: guest A uploads a synthetic file;
guest B lists only B's files and receives 404 for A's ID; registered C also receives
404. A upgrades and retains only A's media. Unauthenticated requests receive 401;
foreign, nonexistent and legacy ownerless IDs remain indistinguishable. Never
use real customer files or production accounts for this check.

Cleanup boundary: only proven-owned guest data, including files, is eligible
strictly after more than 24 hours without activity. Registered users and their
materials, active guests, foreign and legacy ownerless records are excluded.
The current implementation records explicit activity and provides eligibility
logic but **does not run a deletion worker or scheduler**. Media requests and
background refresh do not automatically update `lastActiveAt`. Do not interpret
this documented future policy as automatic deletion or deployment authorization.
Unhandled dependency/registration exceptions still have no stable JSON error
contract; documented 503 responses describe explicit unavailable-service checks.
