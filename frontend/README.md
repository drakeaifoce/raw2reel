# Raw2Reel

AI-powered short-form video editing co-pilot for Instagram Reels and TikTok creators.
Upload a raw media dump — Raw2Reel finds the highlights (Muse Vision), captions the speech
(Muse Voice Transcribe), picks the hook and cuts everything to the beat (Muse Spark).

> **Status:** hackathon frontend. Everything is UI-only: auth, uploads, face detection and
> generation are mocked on the client. No backend is wired in yet.

## Stack

| Concern      | Choice                                                  |
| ------------ | ------------------------------------------------------- |
| UI           | React 19 + TypeScript (strict)                          |
| Build        | Vite 8                                                  |
| Routing      | React Router                                            |
| State        | Zustand (client-only edit session)                      |
| Styling      | CSS Modules + design tokens as CSS custom properties    |
| Fonts        | Inter, Space Grotesk via Fontsource (self-hosted)       |
| Architecture | [Feature-Sliced Design](https://feature-sliced.design/) |
| Linting      | oxlint, Steiger (FSD rules), Prettier                   |

## Getting started

### 1. Prerequisites

| Tool    | Version   | Why                                                  |
| ------- | --------- | ---------------------------------------------------- |
| Node.js | `>=22.12` | Required by Vite 8 (pinned to 24 LTS in `.nvmrc`)    |
| pnpm    | `10.x`    | Package manager (version pinned in `packageManager`) |
| Git     | any       | Clone the repo                                       |

Install Node with [nvm](https://github.com/nvm-sh/nvm) (recommended — picks the version from
`.nvmrc`):

```bash
nvm install
nvm use
```

Enable pnpm through Corepack, which ships with Node:

```bash
corepack enable
```

Check that both are on the right versions:

```bash
node -v && pnpm -v
```

### 2. Install dependencies

From the project root:

```bash
pnpm install
```

### 3. Run the dev server

```bash
pnpm dev
```

Open http://localhost:5173 and click **Continue as guest**. In the studio:

1. Pick a sample video (or drop any video file — it is not uploaded anywhere).
2. Choose one or more faces.
3. Choose a soundtrack and press **Generate reel**.

To open it from another device on the same network, run `pnpm dev --host`.

### 4. Production build

```bash
pnpm build
pnpm preview
```

`pnpm build` type-checks and writes static files to `dist/`; `pnpm preview` serves that build at
http://localhost:4173. `dist/` can be deployed to any static host (Vercel, Netlify, GitHub
Pages). Because routing is client-side, configure the host to fall back to `index.html` for
unknown paths, otherwise refreshing `/studio` returns 404.

### 5. Checks before pushing

```bash
pnpm typecheck && pnpm lint && pnpm lint:fsd && pnpm format:check
```

### Scripts

| Script              | What it does                        |
| ------------------- | ----------------------------------- |
| `pnpm dev`          | Start the dev server                |
| `pnpm build`        | Type-check and build for production |
| `pnpm preview`      | Serve the production build locally  |
| `pnpm typecheck`    | TypeScript only                     |
| `pnpm lint`         | oxlint (React, a11y, import rules)  |
| `pnpm lint:fsd`     | Steiger — FSD layer/slice rules     |
| `pnpm format`       | Format all files with Prettier      |
| `pnpm format:check` | Prettier check without writing      |

### Troubleshooting

- **`Cannot find native binding` / `Cannot find module '@rolldown/binding-…'`** — Node is older
  than 22.12, so pnpm skipped Vite's native bundler. Switch Node (`nvm use`), then reinstall:
  `rm -rf node_modules && pnpm install`.
- **`Port 5173 is in use`** — Vite picks the next free port and prints it; or run
  `pnpm dev --port 3000`.
- **`ERR_PNPM_BAD_PM_VERSION` or wrong pnpm version** — run `corepack enable` so the version from
  `packageManager` is used.
- **Peer dependency warning about `typescript@^5`** during install — expected (Steiger has not
  declared TypeScript 7 support yet); it does not affect the build or linting.

## Screens

- `/` — landing + guest entry / mock sign-in
- `/studio` — three setup steps (footage → faces → soundtrack), then generation progress and
  the finished reel

## Architecture (FSD)

```
src/
├── app/        # entry: router, global styles, design tokens
├── pages/      # login, studio — route-level composition
├── widgets/    # app-header, edit-setup, reel-output
├── features/   # sign-in, sign-out, upload-footage, select-faces, select-track,
│               # generate-reel, download-reel
├── entities/   # face, video, track, project (edit setup store), reel (generation store)
└── shared/     # ui kit, icons, config (routes), lib helpers
```

Conventions:

- Layers import only from layers below them; slices on the same layer never import each other.
  The one exception is the FSD cross-import API: `entities/<slice>/@x/<consumer>.ts`
  (e.g. `video` exposes its type to `project`).
- Every slice exposes a public API via `index.ts`; import slices only through it.
  `shared/ui` components each have their own entry (`@/shared/ui/button`).
- Segments: `ui/` for components, `model/` for state, types and mocks.
- Mocks live next to the entity they describe (`entities/*/model/mocks.ts`) so they can be
  replaced by API calls slice by slice.
- `fsd/insignificant-slice` is disabled in `steiger.config.ts`: slices are split up front as
  integration points for the backend.
