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
- [ai](ai/) — Python 3.12, FastAPI, uv. Orchestrates the external Muse pipelines
  and preprocesses images; holds no local models.
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

## CI/CD

Pushes run through Gitea Actions on the deployment host, not GitHub Actions. Only
the projects touched by a change are built. See [infra/README.md](infra/README.md)
for the pipeline, rollback behaviour and known trade-offs.
