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
└── backend/    # API and Muse pipeline integration (coming soon)
```

Each app is self-contained: its own dependencies, scripts, linters and README.

| App                   | Stack                        | Docs                                     |
| --------------------- | ---------------------------- | ---------------------------------------- |
| [frontend](frontend/) | React 19, TypeScript, Vite 8 | [frontend/README.md](frontend/README.md) |
| backend               | —                            | —                                        |

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
