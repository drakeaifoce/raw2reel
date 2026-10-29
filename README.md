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
