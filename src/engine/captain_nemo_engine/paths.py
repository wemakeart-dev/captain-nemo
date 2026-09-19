from __future__ import annotations

import sys
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ENGINE_DIR.parent
REPO_ROOT = SRC_DIR.parent
GENERATED_PYTHON = SRC_DIR / "generated" / "python"
DEFAULT_CATALOG = REPO_ROOT / "data" / "catalog"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765


def ensure_generated_path() -> None:
    path = str(GENERATED_PYTHON)
    if path not in sys.path:
        sys.path.insert(0, path)
