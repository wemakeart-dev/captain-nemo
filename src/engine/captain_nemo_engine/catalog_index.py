from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def index_path(catalog_root: Path) -> Path:
    return catalog_root / "nemo-index.json"


def load_index(catalog_root: Path) -> dict[str, Any]:
    path = index_path(catalog_root)
    if not path.exists():
        return {"instruments": []}
    return json.loads(path.read_text(encoding="utf-8"))


def upsert_instrument(catalog_root: Path, item: dict[str, Any]) -> dict[str, Any]:
    catalog_root.mkdir(parents=True, exist_ok=True)
    payload = load_index(catalog_root)
    items = [entry for entry in payload.get("instruments", []) if entry.get("instrument_id") != item["instrument_id"]]
    items.append(item)
    payload["instruments"] = sorted(items, key=lambda entry: entry["instrument_id"])
    index_path(catalog_root).write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload
