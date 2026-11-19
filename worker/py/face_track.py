#!/usr/bin/env python3
"""
Detección de rostros para el reencuadre inteligente (OpenCV YuNet).

Uso: face_track.py <video> <start_sec> <end_sec> <sample_fps> <yunet_model>
Salida (stdout): JSON {"width","height","samples":[{"t": seg_relativo, "faces": [[cx, cy, w, h, score], ...]}]}
Las coordenadas están en píxeles del video original. Se analiza a ~640 px de ancho por velocidad.
"""
import json
import sys

import cv2


def main():
    path, start, end, fps, model = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise SystemExit("No se pudo abrir el video para detectar rostros")
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    scale = min(1.0, 640.0 / max(W, 1))
    sw, sh = max(1, int(W * scale)), max(1, int(H * scale))
    det = cv2.FaceDetectorYN.create(model, "", (sw, sh), 0.6, 0.3, 50)

    samples = []
    step = 1.0 / fps
    t = start
    cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000)
    next_t = start
    while t <= end:
        ok, frame = cap.read()
        if not ok:
            break
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        if t + 1e-3 < next_t:
            continue
        next_t += step
        small = cv2.resize(frame, (sw, sh)) if scale < 1 else frame
        _, faces = det.detect(small)
        out = []
        if faces is not None:
            for f in faces:
                x, y, w, h, score = float(f[0]), float(f[1]), float(f[2]), float(f[3]), float(f[14])
                out.append([round((x + w / 2) / scale, 1), round((y + h / 2) / scale, 1), round(w / scale, 1), round(h / scale, 1), round(score, 3)])
        samples.append({"t": round(t - start, 3), "faces": out})
    json.dump({"width": W, "height": H, "samples": samples}, sys.stdout)


if __name__ == "__main__":
    main()
