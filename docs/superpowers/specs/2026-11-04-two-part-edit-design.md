# Two-part 20-second edit

Approved in chat: hybrid, always approximately 20 seconds, including requests that send duration=15.

Intent: intelligible dialogue setup followed by an energetic, music-led montage.
Public prepare/render contracts, backend and frontend remain unchanged. Prepare is untouched.

Approaches: prompt-only is inexpensive but cannot guarantee rhythm, muting or subtitle boundaries.
Chosen hybrid: Spark selects and orders approved material; deterministic scheduling enforces structure.

Output: 600 frames at 30 fps. Setup: at most two source clips, ideally 6–8 seconds, hard cap 8;
shorter when approved dialogue cannot supply more. Preserve selected dialogue order. Impact: shots
normally 0.4–0.9 seconds, on beats when available, alternate approved sources when possible. Reuse
approved source intervals as needed; never extend outside reviewed/model-approved intervals.
No freeze padding, invented content or cloud regeneration loop. Report limited material in warnings.

Model plan remains the same internal schema. Source overlap validation is retained for the reservoir;
intentional repetition happens only in the deterministic final schedule. Source validation occurs first.

Source audio: audible during setup, faded out immediately before the boundary, zero throughout impact.
Music: quiet and ducked in setup, normalized gain 0.5 during impact. Align a detected/preset drop to the
boundary by soundtrack offset or initial delay. Four bundled samples have fingerprint-keyed presets;
unknown tracks use deterministic energy-rise detection with an explicit fallback. Keep track looping.

Visuals: subject-following portrait crop retained; short alternating zoom-in/out gestures on impact
cuts, no overlapping xfade that changes duration. Mild contrast/saturation/sharpening, no promise of
recovering source detail. Short karaoke-style ASS captions in setup only; active-word timing estimated
from transcript turns, not presented as forced alignment. Captions=false still disables all captions.

Builder choices: preserve duration validation but use fixed20 internally; log requested/effective values.
Retain no-music/no-speech input support with warnings, mute source impact even without soundtrack.
No API keys, paid model calls, deployments, commits or pushes for verification.

Validation: pure schedule and caption tests; synthetic drop/alignment tests; real FFmpeg audio-frequency,
subtitle-frame, zoom and duration tests; fake-cloud pipeline integration with real media operations;
full AI suite, lint, formatting and unchanged frontend/backend/API-contract checks.
