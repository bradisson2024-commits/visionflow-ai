#!/usr/bin/env python3
"""
Transcripción local con Whisper (sherpa-onnx) + detección de voz (Silero VAD).

Uso: transcribe_local.py <audio_wav_16k_mono> <model_dir> <vad_model> <language|auto> <threads>
Salida (stdout): JSON {"language": str, "segments": [{"s","e","text","words":[{"w","s","e"}]}]}
Progreso (stderr): líneas "PROGRESS <0-100>"

Los modelos ONNX de Whisper publicados no exponen tiempos por token, así que:
  - los tiempos de cada segmento vienen del VAD (exactos al nivel de frase);
  - los tiempos de cada palabra se ESTIMAN repartiendo el segmento según la
    longitud de cada palabra. Se indica en la app como "tiempos estimados".
"""
import json
import os
import sys
import wave

import numpy as np
import sherpa_onnx


def find(model_dir, suffix):
    files = sorted(f for f in os.listdir(model_dir) if f.endswith(suffix))
    int8 = [f for f in files if "int8" in f]
    pick = (int8 or files)
    if not pick:
        raise SystemExit(f"No se encontró *{suffix} en {model_dir}")
    return os.path.join(model_dir, pick[0])


def main():
    wav_path, model_dir, vad_model, language, threads = sys.argv[1:6]
    sr = 16000
    with wave.open(wav_path) as w:
        if w.getframerate() != sr or w.getnchannels() != 1:
            raise SystemExit("El audio debe ser WAV mono a 16 kHz")
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0

    recognizer = sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=find(model_dir, "encoder.int8.onnx") if any(f.endswith("encoder.int8.onnx") for f in os.listdir(model_dir)) else find(model_dir, "encoder.onnx"),
        decoder=find(model_dir, "decoder.int8.onnx") if any(f.endswith("decoder.int8.onnx") for f in os.listdir(model_dir)) else find(model_dir, "decoder.onnx"),
        tokens=find(model_dir, "tokens.txt"),
        language="" if language == "auto" else language,
        task="transcribe",
        num_threads=int(threads),
    )

    cfg = sherpa_onnx.VadModelConfig()
    cfg.silero_vad.model = vad_model
    cfg.silero_vad.min_silence_duration = 0.35
    cfg.silero_vad.min_speech_duration = 0.25
    cfg.silero_vad.max_speech_duration = 20
    cfg.sample_rate = sr
    vad = sherpa_onnx.VoiceActivityDetector(cfg, buffer_size_in_seconds=60)

    # 1) Detecta tramos de voz
    speech = []
    win = cfg.silero_vad.window_size
    for i in range(0, len(audio), win):
        vad.accept_waveform(audio[i : i + win])
        while not vad.empty():
            seg = vad.front
            speech.append((seg.start, np.array(seg.samples, dtype=np.float32)))
            vad.pop()
    vad.flush()
    while not vad.empty():
        seg = vad.front
        speech.append((seg.start, np.array(seg.samples, dtype=np.float32)))
        vad.pop()

    # 2) Transcribe cada tramo
    segments = []
    total = max(1, len(speech))
    detected_lang = None if language == "auto" else language
    for idx, (start, samples) in enumerate(speech):
        stream = recognizer.create_stream()
        stream.accept_waveform(sr, samples)
        recognizer.decode_stream(stream)
        res = stream.result
        text = res.text.strip()
        if getattr(res, "lang", None) and not detected_lang:
            detected_lang = res.lang.strip("<|>") or None
        s = start / sr
        e = s + len(samples) / sr
        tokens = text.split()
        if tokens:
            # Reparto proporcional a la longitud (más 1 por el espacio)
            weights = np.array([len(t) + 1 for t in tokens], dtype=np.float64)
            # deja un pequeño margen inicial/final típico del VAD
            ts, te = s + 0.05, max(s + 0.1, e - 0.05)
            edges = ts + np.concatenate([[0], np.cumsum(weights)]) / weights.sum() * (te - ts)
            words = [{"w": t, "s": round(float(edges[k]), 3), "e": round(float(edges[k + 1]), 3)} for k, t in enumerate(tokens)]
            segments.append({"s": round(s, 3), "e": round(e, 3), "text": text, "words": words})
        print(f"PROGRESS {int((idx + 1) / total * 100)}", file=sys.stderr, flush=True)

    json.dump({"language": detected_lang or "auto", "segments": segments}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
