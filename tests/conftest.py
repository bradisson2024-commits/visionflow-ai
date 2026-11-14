import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    import faceless.config as cfg
    monkeypatch.setattr(cfg, "DATA_DIR", tmp_path)
    return tmp_path


@pytest.fixture
def settings():
    from faceless.config import load_settings
    return load_settings()
