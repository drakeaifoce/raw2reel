# Two-part Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task.

**Goal:** Fixed ~20s cinematic edits with a dialogue setup and silent-source rapid impact montage.
**Architecture:** Existing Spark EditPlan supplies validated material to a pure frame-based scheduler.
Soundtrack alignment, setup-only karaoke captions and FFmpeg effects remain internal to AI render.
**Tech Stack:** Python, existing Pydantic models, FFmpeg/libass, stdlib PCM analysis, pytest.
**Spec:** docs/superpowers/specs/2026-11-04-two-part-edit-design.md

## Global constraints
Only AI implementation/tests/docs. Keep HTTP/CLI input fields and prepared analysis schema.
Work on the user's existing fix/ai feature branch; no commits, pushes or deployments requested.

## Task 1: Frame-based scheduling
- [x] Add failing pure tests for 600 frames, <=2 setup clips, <=8s setup, rapid impact cuts,
      two-source reuse, frame rounding, approved bounds, missing/short material and beat alignment.
- [x] Implement edit_structure.py; retain model overlap validator and validate reservoir first.
- [x] Run schedule tests (Expected: all pass).

## Task 2: Soundtrack alignment and captions
- [x] Add failing tests for drop-energy detection, quiet/constant fallback, preset fingerprint,
      early-drop delay/late-drop offset, captions clipped at boundary and active yellow word.
- [x] Implement soundtrack.py, fingerprint presets and setup-only ASS generation in planning.py.
- [x] Run focused tests (Expected: pass); analyze bundled sample waveforms to set presets.

## Task 3: Rendering and integration
- [x] Add failing real-media tests for silent impact source, music boundary, caption disappearance,
      20s result despite duration=15, zoom movement, and insufficient reviewed material reuse.
- [x] Integrate scheduling/alignment into CloudPipeline.render; strengthen Spark prompts without new calls.
- [x] Extend MediaTools.render internally with epic effects and music delay, retain direct-call defaults.
- [x] Cache repeated identical cuts; enforce exact output frames and retain tracked crops.
- [x] Update affected integration expectations and documentation.
- [x] Full AI tests, Ruff, diff checks (Expected: green, no backend/frontend/API edits).

## Review focus
Audio alignment with loop and early drop, original speech leaking across boundary, large/gapped source
intervals, subframe rounding and tiny terminal cuts, repeated footage bounds, zoom CPU/memory cost,
ASR approximation and ASS injection, zero-audio/music inputs, retained HTTP contract behavior.

Validation:86 AI tests passed; Ruff lint/format clean. Independent review P2 regressions
were reproduced RED then fixed GREEN; follow-up review found no new major issue.
No paid cloud call, deployment, commit or push was performed.
