# Cloud Edit Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build cloud-only discovery, selected-person tracking, budgeted Spark planning and reframed two-phase reel rendering.
**Architecture:** Independent v2 prepare JSON and render operations, sharing existing MediaTools and MetaClient. Backend/Frontend remain unchanged; v1 contract preserved.
**Tech Stack:** Python, FastAPI, Pydantic, httpx, Pillow, FFmpeg; no new neural runtime dependencies.
**Spec:** docs/superpowers/specs/2026-11-01-cloud-edit-pipeline-design.md

## Global Constraints

- All inference uses cloud Meta API; never install neural model weights.
- Bound discovery calls, video seconds reviewed, uploads and JSON payload sizes.
- Persist anonymous IDs and exact source/clip/output coordinate mappings.
- Existing /v1/render and CLI commands continue to work.

## Review Focus

- Scene changes and VFR must not shift source coordinates or reassign SAM IDs.
- Uncertain discovery/tracking must not become proven absence.
- Analysis tampering, mismatched source and invalid thumbnails must be rejected.
- Reordered cuts must remap subtitles, tracking and impact time consistently.
- Lost targets/multiple targets require deterministic, documented crop fallback.

### Task 1: Cloud feasibility and wire contracts
- [x] Run one bounded real SAM face/box call and Spark grouping on short existing footage; safe metadata only.
- [x] Add `cloud_models.py` validated artifact, observation, track, candidate and edit-plan schemas.
- [x] Add `cloud_meta.py`: SAM output parser and cloud calls with schema validation, completed-state checks, file cleanup and usage counters.
- [x] Tests: malformed/out-of-order SAM frames, remote failure, anonymous grouping and invalid plans.

### Task 2: Preparation artifacts
- [x] Add `cloud_media.py` for scene sampling, CFR analysis clips, timestamps and frames.
- [x] Add `cloud_pipeline.py`: prepare(source, analysis_path), observations and reference thumbnails, transcription cache.
- [x] Add `analysis.py`: bounded JSON payload with data-URL thumbnails, schema and fingerprint validation.
- [x] Tests: malformed JSON and invalid JPEG/base64, unknown observations, source mismatch and retained transcript.

### Task 3: Planning and rendering
- [x] Implement selected-seed per-shot SAM tracking, text preselection and video review within budget.
- [x] Spark outputs ordered EditPlan; quantize cuts before timestamps, subtitles and audio phases.
- [x] Extend MediaTools.render optional safe portrait filters and two-phase mix; preserve defaults.
- [x] Tests: nonchronological clips, insufficient candidates, smooth crop limits, impact and audio transition, FFmpeg output.

### Task 4: Entry points and documentation
- [x] Add `cloud_api.py` router sharing authentication/admission slot with v1; multipart prepare/render via Swagger.
- [x] Add prepare/render-v2 CLI commands, environment limits and integration documentation.
- [x] Run existing/new suite and Ruff, limited real prepare/render smoke if API access permits.
- [x] Fresh whole-change review, fix substantive issues, report actual verified limitations.

## Execution record

- User approved implementation; continuing inline without another plan approval.
- Work remains in existing feature branch, no backend/frontend edits or push.

- Task 1: complete. Real SAM image face localization and Spark anonymous grouping succeeded; no new neural dependencies.
- Task 2: complete. Portable validated JSON catalog, thumbnails and reusable transcript implemented.
- Task 3: complete. SAM per-scene tracking, budgeted two-pass Spark, timed plan, crop and audio implemented.
- Task 4: complete. CLI/Swagger v2, documentation, existing v1 compatibility tested; frontend/backend unchanged.
- Ruling: use documented non-streaming SAM responses on short bounded CFR clips — simpler bounded parsing; media output stored only transiently.
- Ruling: discovery remains sampled and cloud grouping approximate — completeness is explicitly unknown, never a promise to find all faces.
- Ruling: first-selected-person priority when a group cannot fit portrait; preserve request order.
- Real probe exposed missed hard cuts at scene threshold .4; measured .29 on movie footage, changed to .18 with regression test and reset tracking per detected scene.
- Fresh review identified aspect-dependent group fit and actual CFR review duration; both reproduced by failing tests, fixed and re-reviewed successfully.
- Real smoke: four-second movie excerpt prepared with two sampled scene frames, three face observations grouped into two anonymous characters. Selected p1 tracked over 1.6 seconds; final 0.933333-second edit created with impact at 0.466667. Visual check confirmed selected face centered. This validates API wiring, not whole-film quality.
- No commits, pushes, deploy or backend/frontend changes performed.

- Final verification: 53 pytest tests passed with local FFmpeg/ffprobe; Ruff check and format check clean; git diff --check clean. No deferred review findings.

- User requested JSON-only transfer: removed packaging module, prepare returns catalog/thumbnails/calls, render accepts analysis JSON field; CLI uses prepared.json and --analysis.
- Debug investigation: full input reached grouping but cloud response did not finish. Prior invalid_input cause cannot be recovered from its discarded exception. Added safe model status/token-limit diagnostics and --debug; grouping uses four observations per batch and explicit low reasoning.

- JSON-only verification: 58 tests passed; Ruff check/format and diff whitespace checks clean. Fresh review found no substantive JSON-contract issue. Real short prepare returned catalog/thumbnails/calls with two characters and three valid JPEGs. Full input after grouping changes was not rerun; original invalid_input root cause remains unconfirmed.
