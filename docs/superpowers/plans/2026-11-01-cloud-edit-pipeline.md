# Cloud Edit Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build cloud-only discovery, selected-person tracking, budgeted Spark planning and reframed two-phase reel rendering.
**Architecture:** Independent v2 prepare ZIP and render operations, sharing existing MediaTools and MetaClient. Backend/Frontend remain unchanged; v1 contract preserved.
**Tech Stack:** Python, FastAPI, Pydantic, httpx, Pillow, FFmpeg; no new neural runtime dependencies.
**Spec:** docs/superpowers/specs/2026-11-01-cloud-edit-pipeline-design.md

## Global Constraints

- All inference uses cloud Meta API; never install neural model weights.
- Bound discovery calls, video seconds reviewed, uploads and ZIP extraction.
- Persist anonymous IDs and exact source/clip/output coordinate mappings.
- Existing /v1/render and CLI commands continue to work.

## Review Focus

- Scene changes and VFR must not shift source coordinates or reassign SAM IDs.
- Uncertain discovery/tracking must not become proven absence.
- Artifact tampering, mismatched source and malicious ZIPs must be rejected.
- Reordered cuts must remap subtitles, tracking and impact time consistently.
- Lost targets/multiple targets require deterministic, documented crop fallback.

### Task 1: Cloud feasibility and wire contracts
- [x] Run one bounded real SAM face/box call and Spark grouping on short existing footage; safe metadata only.
- [x] Add `cloud_models.py` validated artifact, observation, track, candidate and edit-plan schemas.
- [x] Add `cloud_meta.py`: SAM output parser and cloud calls with schema validation, completed-state checks, file cleanup and usage counters.
- [x] Tests: malformed/out-of-order SAM frames, remote failure, anonymous grouping and invalid plans.

### Task 2: Preparation artifacts
- [x] Add `cloud_media.py` for scene sampling, CFR analysis clips, timestamps and frames.
- [x] Add `cloud_pipeline.py`: prepare(source, artifact_path), observations and reference thumbnails, transcription cache.
- [x] Add `artifacts.py`: bounded ZIP read/write with allowlisted filenames and fingerprint validation, no extractall.
- [x] Tests: archive traversal/bomb, unknown observations, source mismatch and retained transcript.

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
- Task 2: complete. Portable validated ZIP catalog, thumbnails and reusable transcript implemented.
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
