import io
import zipfile
from pathlib import Path

import pytest

from captain_nemo_engine.vision.extract import extract_csv
from captain_nemo_engine.vision.http import DownloadError, download_archive
from captain_nemo_engine.vision.trades import download, spec

from vision_fakes import FakeOpener, FIXTURE, checksum_bytes, vision_files, zip_bytes


def test_download_extracts_csv_and_verifies_checksum(tmp_path: Path) -> None:
    item = spec("um", "BTCUSDC", "monthly", "08-2026")
    csv_payload = FIXTURE.read_bytes()
    opener = FakeOpener(vision_files(item, "BTCUSDC-trades-2026-08.csv", csv_payload))
    csv_path = download(item, tmp_path, opener=opener)
    assert csv_path.is_file()
    assert csv_path.name == "BTCUSDC-trades-2026-08.csv"
    assert csv_path.read_bytes() == csv_payload
    assert item.download_url in opener.calls
    assert item.checksum_url in opener.calls


def test_skip_existing_zip_when_checksum_matches(tmp_path: Path) -> None:
    item = spec("um", "BTCUSDC", "monthly", "08-2026")
    csv_payload = FIXTURE.read_bytes()
    files = vision_files(item, "BTCUSDC-trades-2026-08.csv", csv_payload)
    dest = tmp_path / item.relative_dir
    dest.mkdir(parents=True)
    archive = dest / item.archive_name
    archive.write_bytes(files[item.download_url])
    opener = FakeOpener(files)
    result = download_archive(item, tmp_path, opener=opener)
    assert result == archive
    assert item.download_url not in opener.calls
    assert item.checksum_url in opener.calls


def test_http_404_is_download_failed(tmp_path: Path) -> None:
    item = spec("um", "BTCUSDC", "monthly", "08-2026")
    opener = FakeOpener({})
    with pytest.raises(DownloadError) as exc:
        download(item, tmp_path, opener=opener)
    assert exc.value.code == "DOWNLOAD_FAILED"
    assert "not found" in exc.value.message


def test_checksum_mismatch_deletes_archive(tmp_path: Path) -> None:
    item = spec("um", "BTCUSDC", "monthly", "08-2026")
    archive = zip_bytes("BTCUSDC-trades-2026-08.csv", FIXTURE.read_bytes())
    opener = FakeOpener(
        {
            item.download_url: archive,
            item.checksum_url: checksum_bytes(b"other", item.archive_name),
        }
    )
    with pytest.raises(DownloadError) as exc:
        download_archive(item, tmp_path, opener=opener)
    assert "checksum" in exc.value.message
    assert not (tmp_path / item.relative_path).exists()


def test_extract_rejects_zip_slip(tmp_path: Path) -> None:
    archive = tmp_path / "slip.zip"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("../evil.csv", b"id,price\n")
    archive.write_bytes(buf.getvalue())
    with pytest.raises(DownloadError) as exc:
        extract_csv(archive, tmp_path / "out")
    assert "unsafe" in exc.value.message


def test_extract_rejects_missing_csv(tmp_path: Path) -> None:
    archive = tmp_path / "empty.zip"
    archive.write_bytes(zip_bytes("readme.txt", b"nope"))
    with pytest.raises(DownloadError) as exc:
        extract_csv(archive, tmp_path)
    assert "no csv" in exc.value.message


def test_refuses_non_vision_url(tmp_path: Path) -> None:
    from captain_nemo_engine.vision.http import download_url

    with pytest.raises(DownloadError):
        download_url("https://example.com/file.zip", tmp_path / "file.zip")
