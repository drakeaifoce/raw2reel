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

Requires Node `>=22.12` (see `.nvmrc`) and pnpm.

```bash
nvm use
pnpm install
pnpm dev
```

| Script              | What it does                        |
| ------------------- | ----------------------------------- |
| `pnpm dev`          | Start the dev server                |
| `pnpm build`        | Type-check and build for production |
| `pnpm typecheck`    | TypeScript only                     |
| `pnpm lint`         | oxlint (React, a11y, import rules)  |
| `pnpm lint:fsd`     | Steiger — FSD layer/slice rules     |
| `pnpm format:check` | Prettier check                      |

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
