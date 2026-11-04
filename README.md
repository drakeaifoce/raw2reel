# Raw2Reel

AI-powered short-form video editing co-pilot for Instagram Reels and TikTok creators.
Upload a source video, choose the characters and a soundtrack, and generate a 20-second 9:16 edit.

- **SAM 3.1** — cloud face detection and selected-person tracking
- **Muse Spark** — face grouping, scene selection and the narrative/edit plan
- **Muse Voice Transcribe** — timed source dialogue and captions for the final setup
- **FFmpeg / Pillow** — local media preparation, portrait framing, sound mixing and rendering

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
  cloud SAM/Muse calls and renders with FFmpeg; holds no local neural models.
- [infra](infra/) — deployment and CI. Docs: [infra/README.md](infra/README.md)

## How generation works

1. The frontend uploads source media through the backend. `POST /api/analyses`
   queues analysis; the worker calls AI `POST /v2/prepare` with the video.
2. AI detects scenes, samples up to 16 frames, retains up to 32 face observations,
   groups them into anonymous characters and transcribes source speech. These are
   defaults, overridable in the AI environment. The backend stores the analysis;
   the UI shows character thumbnails for selection.
3. `POST /api/renders` queues generation with the analysis, selected people and
   optional soundtrack. The worker sends the source and saved analysis to `/v2/render`.
4. Spark selects material and watches a bounded review montage **with source audio**.
   It chooses a complete spoken setup, then reaction/action highlights. Setup length
   follows the end of the thought, not a fixed 6–8 second timer: normally one or two
   shots, up to 14 seconds, leaving at least six seconds for impact.
5. Code assembles 600 frames at 30 FPS. The impact section uses fast 0.4–0.9 second
   shots, reusing approved footage when needed. Original audio and captions stop at
   the transition; soundtrack gain rises to 0.5 after normalization. Zoom gestures
   and mild color/sharpness correction are applied locally.
6. Selected scenes lacking a usable track get reference-based grounding and further
   SAM tracking within the tracking budget. Stable letterbox bars are removed before
   portrait cropping and coordinates are transformed accordingly. If identity cannot
   be located reliably, the complete frame is retained instead of cropping a person away.
7. Captions are transcribed again from the **exact final setup audio**, in output order,
   with speech endpoint detection and low-energy padding trimmed. Word highlighting
   is still approximate: Muse Voice supplies turn timestamps, not word timestamps.
8. AI returns H.264/AAC MP4 at 720×1280. The backend stores it and updates the job;
   the frontend polls status and exposes playback/download.

`prepare` and `render` use cloud models. Rendering reuses the saved catalog, but
selected-shot refinement and setup captioning can add cloud calls. No local GPU is
required. The `duration` input remains accepted for compatibility; the current edit
policy produces **20 seconds** even when the frontend sends 15. `captions=false`
disables visible captions and the extra setup transcription.

## Run the AI pipeline locally

```bash
cd ai
uv sync --locked
# Configure MODEL_API_KEY in ../.env; FFmpeg/ffprobe must be installed.
.venv/bin/python -m raw2reel_ai --env-file ../.env prepare \
  /path/to/source.mp4 --output outputs/prepared.json

# Choose a person ID from prepared.json, then generate with the same source.
.venv/bin/python -m raw2reel_ai --env-file ../.env --debug render-v2 \
  /path/to/source.mp4 --analysis outputs/prepared.json --person p1 \
  --music /path/to/music.mp3 --output outputs/reel.mp4
```

The output MP4 and `.v2.json` timeline are written side by side. An existing v2
analysis remains compatible; rerun only `render-v2` to apply rendering changes.
Local binaries in `ai/.tools/` take priority over PATH; explicit `FFMPEG_PATH` and
`FFPROBE_PATH` override both. FFmpeg needs libx264, AAC and libass. Required render
filters are checked before cloud calls; `--debug` shows readable traceback and the
last 16 KiB of external FFmpeg diagnostics. Structured logs carry a `request_id`.
AI HTTP additionally requires `AI_SERVICE_TOKEN` shared only with the backend.

Detailed installation, environment variables, HTTP contract and tests:
[AI README](ai/README.md), [pipeline contract](ai/CLOUD_PIPELINE.md),
[logging](ai/LOGGING.md). For the complete site, also follow
[backend setup](backend/README.md) and [infrastructure setup](infra/README.md).

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

### Swagger browser acceptance

From `backend`, run `bunx playwright install --with-deps chromium --only-shell`
once, then `bun run test:docs:browser`. The backend CI runs the same check.
It starts an isolated local backend with no database/auth/storage connections and
checks `/docs`, `/docs/`, `/api/docs`, and `/api/docs/` in fresh Chromium contexts.
Each route must render all documented operations, load the correct JSON and local
assets, and produce no console warnings/errors, failed requests or HTTP errors.
Set `DOCS_SCREENSHOT=/tmp/swagger.png` to save a screenshot of `/api/docs`.
