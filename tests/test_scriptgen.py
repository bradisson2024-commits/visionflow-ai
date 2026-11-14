import json
from pathlib import Path

import pytest

from faceless import scriptgen

EX = Path(__file__).resolve().parent.parent / "examples"


def sample():
    return json.loads((EX / "curiosidad_total.json").read_text(encoding="utf-8"))


def test_examples_are_valid():
    for f in EX.glob("*.json"):
        scriptgen.validate_script(json.loads(f.read_text(encoding="utf-8")), 150)


def test_rejects_wrong_section_order():
    s = sample()
    s["scenes"][0], s["scenes"][-1] = s["scenes"][-1], s["scenes"][0]
    with pytest.raises(scriptgen.ScriptError, match="Orden"):
        scriptgen.validate_script(s)


def test_rejects_copied_phrases():
    s = sample()
    ref = {"video_id": "X", "title": "Arqueólogos que excavaban tumbas del antiguo Egipto encontraron", "description": ""}
    with pytest.raises(scriptgen.ScriptError, match="copiada"):
        scriptgen.validate_script(s, references=[ref])


def test_rejects_bad_length():
    with pytest.raises(scriptgen.ScriptError, match="palabras"):
        scriptgen.validate_script(sample(), target_words=1000)


def test_generate_retries_with_feedback(monkeypatch, data_dir):
    """API de Claude SIMULADA: primera respuesta inválida, segunda válida."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    good = sample()
    bad = {**good, "scenes": good["scenes"][1:]}  # sin gancho
    replies = [json.dumps(bad), "```json\n" + json.dumps(good) + "\n```"]
    prompts = []

    class Resp:
        status_code = 200

        def __init__(self, t):
            self.t = t

        def json(self):
            return {"content": [{"type": "text", "text": self.t}]}

    class S:
        def post(self, url, headers=None, json=None, timeout=None):
            assert headers["x-api-key"] == "k" and headers["anthropic-version"]
            prompts.append(json["messages"][0]["content"])
            return Resp(replies[len(prompts) - 1])

    ch = {"key": "curiosidad_total", "name": "C", "niche": "curiosidades", "tone": "x", "target_words": 150}
    refs = [{"video_id": "v1", "title": "Algo", "views_per_day": 10, "duration_s": 30, "channel_title": "c", "description": ""}]
    out = scriptgen.generate_script(ch, refs, session=S())
    assert out["title"] == good["title"] and len(prompts) == 2
    assert "rechazada" in prompts[1] and "v1" in prompts[0]
