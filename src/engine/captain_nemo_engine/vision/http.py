from __future__ import annotations

import hashlib
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

from captain_nemo_engine.vision.constants import BASE_URL
from captain_nemo_engine.vision.spec import VisionError, VisionSpec

CHUNK_SIZE = 1_048_576
Opener = Callable[[str], Any]


class DownloadError(VisionError):
    def __init__(self, message: str) -> None:
        super().__init__("DOWNLOAD_FAILED", message)


def assert_vision_url(url: str) -> None:
    if not url.startswith(BASE_URL):
        raise DownloadError(f"refusing non-vision url: {url}")


def parse_checksum(text: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        raise DownloadError("empty checksum file")
    digest = lines[0].split()[0]
    if len(digest) != 64 or any(char not in "0123456789abcdefABCDEF" for char in digest):
        raise DownloadError("invalid checksum file")
    return digest.lower()


def sha256_file(path: Path, chunk_size: int = CHUNK_SIZE) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            block = handle.read(chunk_size)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def _open(url: str, opener: Opener | None) -> Any:
    assert_vision_url(url)
    open_url = opener or urllib.request.urlopen
    try:
        return open_url(url)
    except urllib.error.HTTPError as exc:
        raise DownloadError(f"file not found: {url}" if exc.code == 404 else f"download failed ({exc.code}): {url}") from exc
    except urllib.error.URLError as exc:
        raise DownloadError(f"download failed: {url}") from exc


def _read_all(url: str, opener: Opener | None) -> bytes:
    response = _open(url, opener)
    try:
        read = getattr(response, "read")
        return read() if read else b""
    finally:
        close = getattr(response, "close", None)
        if close:
            close()


def download_url(
    url: str,
    dest: Path,
    *,
    opener: Opener | None = None,
    chunk_size: int = CHUNK_SIZE,
    skip_existing: bool = True,
) -> Path:
    assert_vision_url(url)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if skip_existing and dest.is_file():
        return dest
    response = _open(url, opener)
    part = dest.with_name(dest.name + ".part")
    try:
        with part.open("wb") as out:
            while True:
                block = response.read(chunk_size)
                if not block:
                    break
                out.write(block)
        part.replace(dest)
    except Exception:
        part.unlink(missing_ok=True)
        raise
    finally:
        close = getattr(response, "close", None)
        if close:
            close()
    return dest


def download_archive(
    spec: VisionSpec,
    dest_root: Path,
    *,
    checksum: bool = True,
    opener: Opener | None = None,
) -> Path:
    dest_dir = Path(dest_root) / spec.relative_dir
    archive = dest_dir / spec.archive_name
    checksum_path = dest_dir / spec.checksum_name
    if archive.is_file() and checksum:
        expected = parse_checksum(_read_all(spec.checksum_url, opener).decode("utf-8"))
        checksum_path.write_text(f"{expected}  {spec.archive_name}\n", encoding="utf-8")
        if sha256_file(archive) == expected:
            return archive
        archive.unlink(missing_ok=True)
    elif archive.is_file():
        return archive
    download_url(spec.download_url, archive, opener=opener, skip_existing=False)
    if checksum:
        expected = parse_checksum(_read_all(spec.checksum_url, opener).decode("utf-8"))
        checksum_path.write_text(f"{expected}  {spec.archive_name}\n", encoding="utf-8")
        actual = sha256_file(archive)
        if actual != expected:
            archive.unlink(missing_ok=True)
            raise DownloadError(f"checksum mismatch: {spec.archive_name}")
    return archive
