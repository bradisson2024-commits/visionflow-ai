from faceless import subtitles


def test_cues_cover_audio_and_are_monotonic():
    texts = ["Hola mundo. Esto es una prueba larga de subtítulos.", "Segunda escena aquí."]
    durs = [4.0, 2.0]
    cues = subtitles.build_cues(texts, durs, gap=0.25)
    assert cues[0][0] == 0
    assert all(a < b for a, b, _ in cues)
    assert all(cues[i][1] <= cues[i + 1][0] + 1e-6 for i in range(len(cues) - 1))
    second_start = next(a for a, _, t in cues if t.startswith("Segunda"))
    assert abs(second_start - 4.25) < 1e-6
    assert abs(cues[-1][1] - 6.25) < 1e-3
    assert " ".join(t for *_, t in cues).split() == " ".join(texts).split()


def test_srt_format(tmp_path):
    p = subtitles.write_srt([(0, 1.5, "a"), (61.25, 3700.0, "b")], tmp_path / "s.srt")
    txt = p.read_text()
    assert "00:00:00,000 --> 00:00:01,500" in txt and "00:01:01,250 --> 01:01:40,000" in txt


def test_no_orphan_words():
    assert subtitles.chunk_words("uno dos tres cuatro cinco") == ["uno dos tres", "cuatro cinco"]
    assert subtitles.chunk_words("a b c d. e") == ["a b c d.", "e"]  # respeta fin de frase
