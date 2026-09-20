from __future__ import annotations

import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

DB_NAME = "nemo-library.sqlite"
PROVIDER_ALIASES = {"binance": "Binance"}
SUPPORTED_DATASETS = {"trades"}
GRANULARITIES = {"daily", "monthly"}
FILENAME_PERIOD = re.compile(r"(\d{4})-(\d{2})(?:-(\d{2}))?")
DAILY_PERIOD = re.compile(r"^(\d{2})-(\d{2})-(\d{4})$")
MONTHLY_PERIOD = re.compile(r"^(\d{2})-(\d{4})$")
ISO_DAILY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
ISO_MONTHLY = re.compile(r"^(\d{4})-(\d{2})$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  dataset TEXT NOT NULL,
  granularity TEXT NOT NULL,
  period TEXT NOT NULL,
  period_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  source_path TEXT NOT NULL UNIQUE,
  instrument_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  start_ns INTEGER NOT NULL,
  end_ns INTEGER NOT NULL,
  trade_count INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS files_tree_slot
  ON files (provider, dataset, granularity, period, file_name);
"""


class LibraryError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def db_path(catalog_root: Path) -> Path:
    return catalog_root / DB_NAME


def connect(catalog_root: Path) -> sqlite3.Connection:
    catalog_root.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path(catalog_root))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    return conn


@contextmanager
def open_db(catalog_root: Path) -> Iterator[sqlite3.Connection]:
    conn = connect(catalog_root)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def canonical_provider(value: str) -> str:
    key = (value or "binance").strip().lower() or "binance"
    if key not in PROVIDER_ALIASES:
        raise LibraryError("IMPORT_FAILED", f"unsupported provider: {value}")
    return PROVIDER_ALIASES[key]


def canonical_dataset(value: str) -> str:
    dataset = (value or "trades").strip() or "trades"
    if dataset.lower() not in SUPPORTED_DATASETS:
        raise LibraryError("IMPORT_FAILED", f"unsupported dataset: {value}")
    return "trades"


def canonical_granularity(value: str) -> str:
    granularity = (value or "").strip().lower()
    if granularity not in GRANULARITIES:
        raise LibraryError("IMPORT_FAILED", f"unsupported granularity: {value}")
    return granularity


def period_key(granularity: str, period: str) -> str:
    display, key = normalize_period(granularity, period)
    del display
    return key


def normalize_period(granularity: str, period: str) -> tuple[str, str]:
    gran = canonical_granularity(granularity)
    text = (period or "").strip()
    if gran == "daily":
        daily = DAILY_PERIOD.match(text)
        if daily:
            day, month, year = daily.group(1), daily.group(2), daily.group(3)
            return f"{day}-{month}-{year}", f"{year}-{month}-{day}"
        iso = ISO_DAILY.match(text)
        if iso:
            year, month, day = iso.group(1), iso.group(2), iso.group(3)
            return f"{day}-{month}-{year}", f"{year}-{month}-{day}"
        raise LibraryError("IMPORT_FAILED", f"daily period must be DD-MM-YYYY: {period}")
    monthly = MONTHLY_PERIOD.match(text)
    if monthly:
        month, year = monthly.group(1), monthly.group(2)
        return f"{month}-{year}", f"{year}-{month}"
    iso = ISO_MONTHLY.match(text)
    if iso:
        year, month = iso.group(1), iso.group(2)
        return f"{month}-{year}", f"{year}-{month}"
    raise LibraryError("IMPORT_FAILED", f"monthly period must be MM-YYYY: {period}")


def infer_period_from_name(name: str) -> tuple[str, str] | None:
    match = FILENAME_PERIOD.search(name)
    if not match:
        return None
    year, month, day = match.group(1), match.group(2), match.group(3)
    if day:
        return "daily", f"{day}-{month}-{year}"
    return "monthly", f"{month}-{year}"


def period_from_ns(start_ns: int, granularity: str) -> str:
    stamp = datetime.fromtimestamp(start_ns / 1_000_000_000, tz=timezone.utc)
    if canonical_granularity(granularity) == "monthly":
        return f"{stamp.month:02d}-{stamp.year}"
    return f"{stamp.day:02d}-{stamp.month:02d}-{stamp.year}"


def resolve_taxonomy(
    path: Path,
    provider: str = "",
    dataset: str = "",
    granularity: str = "",
    period: str = "",
    start_ns: int = 0,
) -> dict[str, str]:
    provider_name = canonical_provider(provider)
    dataset_name = canonical_dataset(dataset)
    gran = (granularity or "").strip().lower()
    display = (period or "").strip()
    inferred = infer_period_from_name(path.name)
    if not gran:
        gran = inferred[0] if inferred else "daily"
    if not display:
        display = inferred[1] if inferred and inferred[0] == gran else ""
    if not display:
        if not start_ns:
            raise LibraryError("IMPORT_FAILED", "time period is required")
        display = period_from_ns(start_ns, gran)
    display, key = normalize_period(gran, display)
    return {
        "provider": provider_name,
        "dataset": dataset_name,
        "granularity": gran,
        "period": display,
        "period_key": key,
        "file_name": path.name,
    }


def _file_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "file_id": row["id"],
        "provider": row["provider"],
        "dataset": row["dataset"],
        "granularity": row["granularity"],
        "period": row["period"],
        "period_key": row["period_key"],
        "file_name": row["file_name"],
        "path": row["source_path"],
        "source_path": row["source_path"],
        "instrument_id": row["instrument_id"],
        "symbol": row["symbol"],
        "start_ns": int(row["start_ns"]),
        "end_ns": int(row["end_ns"]),
        "trade_count": int(row["trade_count"]),
    }


def get_file(catalog_root: Path, file_id: str) -> dict[str, Any] | None:
    with open_db(catalog_root) as conn:
        row = conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
    return _file_dict(row) if row else None


def get_file_by_path(catalog_root: Path, source_path: str) -> dict[str, Any] | None:
    with open_db(catalog_root) as conn:
        row = conn.execute("SELECT * FROM files WHERE source_path = ?", (source_path,)).fetchone()
    return _file_dict(row) if row else None


def list_files(catalog_root: Path) -> list[dict[str, Any]]:
    with open_db(catalog_root) as conn:
        rows = conn.execute(
            """
            SELECT * FROM files
            ORDER BY provider, dataset, granularity, period_key, file_name
            """
        ).fetchall()
    return [_file_dict(row) for row in rows]


def list_instruments(catalog_root: Path) -> list[dict[str, Any]]:
    with open_db(catalog_root) as conn:
        rows = conn.execute(
            """
            SELECT instrument_id,
                   MIN(symbol) AS symbol,
                   MIN(start_ns) AS start_ns,
                   MAX(end_ns) AS end_ns,
                   SUM(trade_count) AS trade_count
            FROM files
            GROUP BY instrument_id
            ORDER BY instrument_id
            """
        ).fetchall()
    return [
        {
            "instrument_id": row["instrument_id"],
            "symbol": row["symbol"],
            "start_ns": int(row["start_ns"] or 0),
            "end_ns": int(row["end_ns"] or 0),
            "trade_count": int(row["trade_count"] or 0),
        }
        for row in rows
    ]


def upsert_file(catalog_root: Path, item: dict[str, Any]) -> dict[str, Any]:
    file_id = item.get("file_id") or str(uuid.uuid4())
    payload = {
        "id": file_id,
        "provider": item["provider"],
        "dataset": item["dataset"],
        "granularity": item["granularity"],
        "period": item["period"],
        "period_key": item["period_key"],
        "file_name": item["file_name"],
        "source_path": item["source_path"],
        "instrument_id": item["instrument_id"],
        "symbol": item["symbol"],
        "start_ns": int(item["start_ns"]),
        "end_ns": int(item["end_ns"]),
        "trade_count": int(item["trade_count"]),
    }
    try:
        with open_db(catalog_root) as conn:
            conn.execute(
                """
                INSERT INTO files (
                  id, provider, dataset, granularity, period, period_key, file_name,
                  source_path, instrument_id, symbol, start_ns, end_ns, trade_count
                ) VALUES (
                  :id, :provider, :dataset, :granularity, :period, :period_key, :file_name,
                  :source_path, :instrument_id, :symbol, :start_ns, :end_ns, :trade_count
                )
                ON CONFLICT(source_path) DO UPDATE SET
                  provider=excluded.provider,
                  dataset=excluded.dataset,
                  granularity=excluded.granularity,
                  period=excluded.period,
                  period_key=excluded.period_key,
                  file_name=excluded.file_name,
                  instrument_id=excluded.instrument_id,
                  symbol=excluded.symbol,
                  start_ns=excluded.start_ns,
                  end_ns=excluded.end_ns,
                  trade_count=excluded.trade_count
                """,
                payload,
            )
    except sqlite3.IntegrityError as exc:
        raise LibraryError("IMPORT_FAILED", "a file already occupies that library path") from exc
    stored = get_file_by_path(catalog_root, payload["source_path"])
    if stored is None:
        raise LibraryError("IMPORT_FAILED", "failed to persist library file")
    return stored


def delete_file(catalog_root: Path, file_id: str) -> dict[str, Any]:
    item = get_file(catalog_root, file_id)
    if item is None:
        raise LibraryError("UNKNOWN_FILE", file_id)
    with open_db(catalog_root) as conn:
        conn.execute("DELETE FROM files WHERE id = ?", (file_id,))
    return item


def move_file(
    catalog_root: Path,
    file_id: str,
    provider: str,
    dataset: str,
    granularity: str,
    period: str,
) -> dict[str, Any]:
    item = get_file(catalog_root, file_id)
    if item is None:
        raise LibraryError("UNKNOWN_FILE", file_id)
    taxonomy = resolve_taxonomy(
        Path(item["file_name"]),
        provider=provider or item["provider"],
        dataset=dataset or item["dataset"],
        granularity=granularity or item["granularity"],
        period=period or item["period"],
        start_ns=int(item["start_ns"]),
    )
    try:
        with open_db(catalog_root) as conn:
            conn.execute(
                """
                UPDATE files
                SET provider = ?, dataset = ?, granularity = ?, period = ?, period_key = ?
                WHERE id = ?
                """,
                (
                    taxonomy["provider"],
                    taxonomy["dataset"],
                    taxonomy["granularity"],
                    taxonomy["period"],
                    taxonomy["period_key"],
                    file_id,
                ),
            )
    except sqlite3.IntegrityError as exc:
        raise LibraryError("IMPORT_FAILED", "a file already occupies that library path") from exc
    moved = get_file(catalog_root, file_id)
    if moved is None:
        raise LibraryError("UNKNOWN_FILE", file_id)
    return moved
