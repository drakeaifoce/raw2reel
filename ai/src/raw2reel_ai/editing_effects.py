"""Fixed FFmpeg effects; no user/model strings become filter expressions."""


def impact_zoom(frames: int, index: int) -> str:
    """Alternating 5-frame zoom gestures across hard cuts, without overlap/retiming."""
    if index % 2 == 0:
        zoom = f"1+0.12*pow(clip((on-{max(0, frames - 6)})/5,0,1),2)"
    else:
        zoom = "1+0.12*pow(1-clip(on/5,0,1),2)"
    return f"zoompan=z='{zoom}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=720x1280:fps=30"


# loudnorm can emit non-finite samples for digital silence on some FFmpeg builds.
# Rechunk its buffered output before time-dependent volume evaluation.
NORMALIZE = (
    "loudnorm=I=-16:TP=-2:LRA=11,aresample=48000,aformat=channel_layouts=stereo,"
    "aeval='if(isnan(val(ch))+isinf(val(ch)),0,val(ch))':c=same,"
    "asetnsamples=n=1024:p=0,asetpts=N/SR/TB"
)

GRADE = "eq=contrast=1.05:saturation=1.07:brightness=-0.004,unsharp=5:5:0.25:3:3:0"


def setup_audio(impact: float) -> str:
    """Sample-accurate fade/trim, then silence; never carry speech across a cut."""
    if impact <= 0:
        return "volume=0"
    fade = min(0.08, impact)
    return f"afade=t=out:st={impact - fade:.9f}:d={fade:.9f},atrim=end={impact:.9f},apad"


def epic_mix(impact: float, delay: float) -> str:
    # Duck only the intro bed: compressor release must not suppress the actual drop.
    return (
        f"[0:a]{NORMALIZE},{setup_audio(impact)},asplit=2[voice][sidechain];"
        f"[1:a]{NORMALIZE},"
        f"adelay={round(delay * 1000)}:all=1,asplit=2[bed][hit];"
        "[bed]volume=0.18[quiet];"
        "[quiet][sidechain]sidechaincompress=threshold=0.035:ratio=6:"
        "attack=15:release=250,"
        f"atrim=end={impact:.9f},apad[intro];"
        f"[hit]atrim=start={impact:.9f},asetpts=PTS-STARTPTS,"
        f"adelay={round(impact * 1000)}:all=1,volume=0.5[impact];"
        "[voice][intro][impact]amix=inputs=3:duration=first:normalize=0,"
        "alimiter=limit=0.89125:level=false:latency=true[a]"
    )
