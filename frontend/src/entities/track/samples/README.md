# Sample tracks

Drop audio files here (`.mp3`, `.wav`, `.m4a`, `.aac`, `.ogg`, `.flac`). The build picks
them up automatically and lists them as soundtrack presets, sorted by file name.

The file name sets what the studio shows, in the usual release naming:

```
Artist - Title - BPM.mp3
```

- `Emin Nilsen - BANE [NCS Release].mp3` → **BANE**, Emin Nilsen
- `X972 - Montagem Toma - 130.mp3` → **Montagem Toma**, X972 · 130 BPM
- `Night ride.mp3` → **Night ride**, Sample

Bracketed tags like `[NCS Release]` are dropped; artist and BPM are optional (`130bpm`
works too). Keep each file under 100 MB, the media upload limit: a preset is uploaded to
the user's media when picked, so the renderer can mix it in. Smaller files start rendering
sooner.

While this folder has no audio, the studio shows placeholder presets without music.
