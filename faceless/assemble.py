"""PASO 3d: montaje final con ffmpeg — imágenes con movimiento (Ken Burns),
voz, subtítulos quemados y música opcional."""
from __future__ import annotations

from pathlib import Path

from .media import require_bin, run


def render_scene(image: Path, seconds: float, out: Path, width: int, height: int, fps: int, index: int) -> Path:
    frames = max(int(seconds * fps), 1)
    zoom_in = index % 2 == 0
    z = f"min(1.0+0.12*on/{frames},1.12)" if zoom_in else f"max(1.12-0.12*on/{frames},1.0)"
    vf = (f"scale={width * 2}:{height * 2}:force_original_aspect_ratio=increase,"
          f"crop={width * 2}:{height * 2},"
          f"zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={width}x{height}:fps={fps},"
          f"format=yuv420p")
    run([require_bin("ffmpeg"), "-y", "-loop", "1", "-i", str(image), "-vf", vf, "-frames:v", str(frames),
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", str(fps), str(out)])
    return out


def assemble_video(images: list[Path], durations: list[float], audio: Path, ass: Path, out: Path,
                   width: int, height: int, fps: int, gap: float = 0.25, music: Path | None = None) -> Path:
    work = out.parent / "scenes"
    work.mkdir(parents=True, exist_ok=True)
    clips = [render_scene(img, d + gap, work / f"clip_{i:02d}.mp4", width, height, fps, i)
             for i, (img, d) in enumerate(zip(images, durations))]
    listfile = work / "concat.txt"
    listfile.write_text("".join(f"file '{c.resolve()}'\n" for c in clips), encoding="utf-8")
    silent = work / "video_silent.mp4"
    run([require_bin("ffmpeg"), "-y", "-f", "concat", "-safe", "0", "-i", str(listfile), "-c", "copy", str(silent)])

    ass_arg = str(ass.resolve()).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
    cmd = [require_bin("ffmpeg"), "-y", "-i", str(silent), "-i", str(audio)]
    if music and Path(music).is_file():
        cmd += ["-stream_loop", "-1", "-i", str(music), "-filter_complex",
                f"[0:v]ass='{ass_arg}'[v];[2:a]volume=0.12[m];[1:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]",
                "-map", "[v]", "-map", "[a]"]
    else:
        cmd += ["-vf", f"ass='{ass_arg}'", "-map", "0:v", "-map", "1:a"]
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(out)]
    run(cmd)
    return out
