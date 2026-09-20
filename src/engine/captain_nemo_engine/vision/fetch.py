from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

from captain_nemo_engine.vision.extract import extract_csv
from captain_nemo_engine.vision.http import Opener, download_archive
from captain_nemo_engine.vision.spec import VisionSpec


def materialize(
    spec: VisionSpec,
    dest_root: Path,
    *,
    checksum: bool = True,
    opener: Opener | None = None,
) -> Path:
    archive = download_archive(spec, dest_root, checksum=checksum, opener=opener)
    return extract_csv(archive, archive.parent)


def materialize_many(
    specs: Iterable[VisionSpec],
    dest_root: Path,
    *,
    checksum: bool = True,
    opener: Opener | None = None,
) -> list[Path]:
    return [materialize(spec, dest_root, checksum=checksum, opener=opener) for spec in specs]
