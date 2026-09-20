from __future__ import annotations

import zipfile
from pathlib import Path

from captain_nemo_engine.vision.http import DownloadError


def _safe_csv_target(dest_dir: Path, name: str) -> Path:
    normalized = name.replace("\\", "/").lstrip("/")
    if not normalized or "/" in normalized or normalized in {".", ".."}:
        raise DownloadError(f"unsafe zip member: {name}")
    if ".." in normalized or ":" in normalized:
        raise DownloadError(f"unsafe zip member: {name}")
    if not normalized.lower().endswith(".csv"):
        raise DownloadError(f"zip member is not csv: {name}")
    target = (dest_dir / normalized).resolve()
    root = dest_dir.resolve()
    if not target.is_relative_to(root):
        raise DownloadError(f"unsafe zip member: {name}")
    return target


def extract_csv(archive: Path, dest_dir: Path | None = None) -> Path:
    dest = Path(dest_dir) if dest_dir is not None else archive.parent
    dest.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(archive) as zf:
            names = [info.filename for info in zf.infolist() if not info.is_dir()]
            csv_names = [name for name in names if name.replace("\\", "/").rsplit("/", 1)[-1].lower().endswith(".csv")]
            if not csv_names:
                raise DownloadError(f"zip has no csv: {archive.name}")
            member = csv_names[0]
            target = _safe_csv_target(dest, member)
            if target.is_file():
                return target
            with zf.open(member) as source, target.open("wb") as out:
                while True:
                    block = source.read(1_048_576)
                    if not block:
                        break
                    out.write(block)
            return target
    except DownloadError:
        raise
    except zipfile.BadZipFile as exc:
        raise DownloadError(f"invalid zip: {archive.name}") from exc
