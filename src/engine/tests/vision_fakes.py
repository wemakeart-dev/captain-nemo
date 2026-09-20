from __future__ import annotations

import hashlib
import io
import urllib.error
import zipfile
from email.message import EmailMessage
from pathlib import Path

from captain_nemo_engine.vision.spec import VisionSpec


class FakeResponse:
    def __init__(self, data: bytes) -> None:
        self._buf = io.BytesIO(data)

    def read(self, size: int = -1) -> bytes:
        return self._buf.read() if size < 0 else self._buf.read(size)

    def close(self) -> None:
        return None


class FakeOpener:
    def __init__(self, files: dict[str, bytes] | None = None) -> None:
        self.files = files or {}
        self.calls: list[str] = []

    def __call__(self, url: str) -> FakeResponse:
        self.calls.append(url)
        if url not in self.files:
            raise urllib.error.HTTPError(url, 404, "Not Found", EmailMessage(), None)
        return FakeResponse(self.files[url])


def zip_bytes(name: str, payload: bytes) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        archive.writestr(name, payload)
    return buf.getvalue()


def checksum_bytes(payload: bytes, name: str) -> bytes:
    digest = hashlib.sha256(payload).hexdigest()
    return f"{digest}  {name}\n".encode("utf-8")


def vision_files(spec: VisionSpec, csv_name: str, csv_payload: bytes) -> dict[str, bytes]:
    archive = zip_bytes(csv_name, csv_payload)
    return {
        spec.download_url: archive,
        spec.checksum_url: checksum_bytes(archive, spec.archive_name),
    }


FIXTURE = Path(__file__).parent / "fixtures" / "BTCUSDC-trades-sample.csv"
