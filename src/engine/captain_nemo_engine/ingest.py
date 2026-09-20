from __future__ import annotations

from pathlib import Path

import pandas as pd
from nautilus_trader.model.data import TradeTick
from nautilus_trader.persistence.catalog import ParquetDataCatalog
from nautilus_trader.persistence.wranglers import TradeTickDataWrangler

from captain_nemo_engine.bars import aggregate_bars
from captain_nemo_engine.csv_loader import instrument_id_from_symbol, iter_trade_chunks, symbol_from_path
from captain_nemo_engine.instruments import perpetual_from_trades
from captain_nemo_engine.console import log_info
from captain_nemo_engine.library import (
    LibraryError,
    canonical_dataset,
    canonical_granularity,
    canonical_provider,
    delete_file,
    get_file,
    get_file_by_path,
    normalize_period,
    resolve_taxonomy,
    upsert_file,
)
from captain_nemo_engine.paths import DEFAULT_DOWNLOADS, ensure_downloads
from captain_nemo_engine.vision.http import Opener
from captain_nemo_engine.vision.spec import VisionError
from captain_nemo_engine.vision import trades as vision_trades

BARS_DIRNAME = "nemo_bars"
TRADES_DIRNAME = "nemo_trades"
STORED_COLUMNS = ["trade_id", "price", "quantity", "quote_qty", "buyer_maker", "ts_event_ns", "file_id"]


def bars_parquet_path(catalog_root: Path, instrument_id: str) -> Path:
    safe = instrument_id.replace("/", "-")
    return catalog_root / BARS_DIRNAME / f"{safe}.parquet"


def trades_parquet_path(catalog_root: Path, instrument_id: str) -> Path:
    safe = instrument_id.replace("/", "-")
    return catalog_root / TRADES_DIRNAME / f"{safe}.parquet"


def _bars_path(catalog_root: Path, instrument_id: str) -> Path:
    return bars_parquet_path(catalog_root, instrument_id)


def _trades_path(catalog_root: Path, instrument_id: str) -> Path:
    return trades_parquet_path(catalog_root, instrument_id)


def _empty_stored() -> pd.DataFrame:
    return pd.DataFrame(columns=STORED_COLUMNS)


def _datetime_index_to_ns(index: pd.Index) -> pd.Series:
    dt = pd.DatetimeIndex(index)
    if dt.tz is None:
        dt = dt.tz_localize("UTC")
    else:
        dt = dt.tz_convert("UTC")
    return pd.Series(dt.as_unit("ns").astype("int64"), index=index)


def _stored_from_chunks(trades: pd.DataFrame, file_id: str) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "trade_id": trades["trade_id"].astype(str),
            "price": trades["price"].astype(str),
            "quantity": trades["quantity"].astype(str),
            "quote_qty": trades["quote_qty"].astype(str),
            "buyer_maker": trades["buyer_maker"].astype(bool),
            "ts_event_ns": _datetime_index_to_ns(trades.index),
            "file_id": file_id,
        }
    )


def _ensure_file_id(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        return _empty_stored()
    if "file_id" not in frame.columns:
        frame = frame.copy()
        frame["file_id"] = ""
    return frame


def _merge_stored(existing: pd.DataFrame, incoming: pd.DataFrame, replace_file_id: str = "") -> pd.DataFrame:
    existing = _ensure_file_id(existing)
    incoming = _ensure_file_id(incoming)
    if replace_file_id and not existing.empty:
        existing = existing[existing["file_id"] != replace_file_id]
    if incoming.empty:
        return existing.reset_index(drop=True) if not existing.empty else _empty_stored()
    if existing.empty:
        combined = incoming
    else:
        combined = pd.concat([existing, incoming], ignore_index=True)
    combined = combined.drop_duplicates(subset=["trade_id"], keep="last")
    return combined.sort_values("ts_event_ns").reset_index(drop=True)


def _last_catalog_ts_ns(catalog: ParquetDataCatalog, instrument_id: str) -> int | None:
    last = catalog.query_last_timestamp(TradeTick, instrument_id)
    if last is None:
        return None
    return int(pd.Timestamp(last).value)


def _write_new_ticks(catalog: ParquetDataCatalog, instrument_id: str, ticks: list) -> None:
    if not ticks:
        return
    last_ns = _last_catalog_ts_ns(catalog, instrument_id)
    to_write = ticks if last_ns is None else [tick for tick in ticks if int(tick.ts_init) > last_ns]
    if to_write:
        catalog.write_data(to_write)


def _validate_import_metadata(provider: str, dataset: str, granularity: str, period: str) -> None:
    if provider:
        canonical_provider(provider)
    if dataset:
        canonical_dataset(dataset)
    if granularity:
        canonical_granularity(granularity)
        if period:
            normalize_period(granularity, period)


def _write_instrument_parquets(catalog_root: Path, instrument_id: str, stored: pd.DataFrame) -> None:
    bars_path = _bars_path(catalog_root, instrument_id)
    trades_path = _trades_path(catalog_root, instrument_id)
    if stored.empty:
        bars_path.unlink(missing_ok=True)
        trades_path.unlink(missing_ok=True)
        return
    bars_source = stored.copy()
    bars_source.index = pd.to_datetime(bars_source["ts_event_ns"], utc=True, unit="ns")
    minute_bars = aggregate_bars(bars_source, "1m")
    bars_path.parent.mkdir(parents=True, exist_ok=True)
    trades_path.parent.mkdir(parents=True, exist_ok=True)
    minute_bars.to_parquet(bars_path)
    stored.to_parquet(trades_path, index=False)


def import_csv(
    path: Path,
    catalog_root: Path,
    instrument_id: str = "",
    chunksize: int = 100_000,
    *,
    provider: str = "",
    dataset: str = "",
    granularity: str = "",
    period: str = "",
) -> dict:
    path = path.resolve()
    if not path.is_file():
        raise FileNotFoundError(str(path))
    _validate_import_metadata(provider, dataset, granularity, period)
    symbol = symbol_from_path(path)
    resolved_id = instrument_id or instrument_id_from_symbol(symbol)
    catalog_root.mkdir(parents=True, exist_ok=True)
    catalog = ParquetDataCatalog(str(catalog_root))
    wrangler: TradeTickDataWrangler | None = None
    instrument_written = False
    trade_frames: list[pd.DataFrame] = []
    ticks: list = []
    for chunk in iter_trade_chunks(path, chunksize=chunksize):
        if chunk.empty:
            continue
        if wrangler is None:
            instrument = perpetual_from_trades(symbol, chunk)
            catalog.write_data([instrument])
            instrument_written = True
            wrangler = TradeTickDataWrangler(instrument=instrument)
            resolved_id = str(instrument.id)
        wrangle = chunk.copy()
        wrangle["price"] = wrangle["price"].astype("float64")
        wrangle["quantity"] = wrangle["quantity"].astype("float64")
        ticks.extend(wrangler.process(wrangle))
        trade_frames.append(chunk)
    if not instrument_written or not trade_frames:
        raise ValueError("no trades found in csv")
    existing_file = get_file_by_path(catalog_root, str(path))
    file_id = existing_file["file_id"] if existing_file else ""
    incoming = _stored_from_chunks(pd.concat(trade_frames, axis=0).sort_index(), file_id or "pending")
    file_start = int(incoming["ts_event_ns"].min())
    file_end = int(incoming["ts_event_ns"].max())
    taxonomy = resolve_taxonomy(
        path,
        provider=provider,
        dataset=dataset,
        granularity=granularity,
        period=period,
        start_ns=file_start,
    )
    record = upsert_file(
        catalog_root,
        {
            "file_id": file_id,
            "provider": taxonomy["provider"],
            "dataset": taxonomy["dataset"],
            "granularity": taxonomy["granularity"],
            "period": taxonomy["period"],
            "period_key": taxonomy["period_key"],
            "file_name": taxonomy["file_name"],
            "source_path": str(path),
            "instrument_id": resolved_id,
            "symbol": symbol,
            "start_ns": file_start,
            "end_ns": file_end,
            "trade_count": int(len(incoming)),
        },
    )
    file_id = record["file_id"]
    incoming["file_id"] = file_id
    stored = _merge_stored(load_trades(catalog_root, resolved_id), incoming, replace_file_id=file_id)
    _write_new_ticks(catalog, resolved_id, ticks)
    _write_instrument_parquets(catalog_root, resolved_id, stored)
    return {
        **record,
        "instrument_id": resolved_id,
        "symbol": symbol,
        "start_ns": int(stored["ts_event_ns"].min()) if not stored.empty else file_start,
        "end_ns": int(stored["ts_event_ns"].max()) if not stored.empty else file_end,
        "trade_count": int(len(stored)),
        "file_trade_count": int(len(incoming)),
        "source_path": str(path),
        "path": str(path),
    }


def import_vision(
    catalog_root: Path,
    *,
    symbol: str,
    trading_type: str = "um",
    dataset: str = "trades",
    granularity: str = "",
    period: str = "",
    provider: str = "Binance",
    download_root: Path | None = None,
    opener: Opener | None = None,
    checksum: bool = True,
) -> dict:
    trading = (trading_type or "um").strip().lower() or "um"
    data = (dataset or "trades").strip() or "trades"
    if trading != "um":
        raise LibraryError("IMPORT_FAILED", f"unsupported trading type: {trading_type}")
    if data.lower() != "trades":
        raise LibraryError("IMPORT_FAILED", f"unsupported dataset: {dataset}")
    if provider:
        canonical_provider(provider)
    try:
        spec = vision_trades.spec(trading, symbol, granularity, period)
    except VisionError as exc:
        raise LibraryError(exc.code, exc.message) from exc
    dest_root = ensure_downloads(download_root or DEFAULT_DOWNLOADS)
    log_info(f"download {spec.download_url}")
    csv_path = vision_trades.download(spec, dest_root, checksum=checksum, opener=opener)
    log_info(f"extracted {csv_path}")
    return import_csv(
        csv_path,
        catalog_root,
        provider=provider,
        dataset="trades",
        granularity=granularity,
        period=period,
    )


def remove_imported_file(catalog_root: Path, file_id: str) -> dict:
    item = get_file(catalog_root, file_id)
    if item is None:
        raise LibraryError("UNKNOWN_FILE", file_id)
    instrument_id = item["instrument_id"]
    stored = load_trades(catalog_root, instrument_id)
    if not stored.empty:
        stored = stored[stored["file_id"] != file_id].reset_index(drop=True)
    delete_file(catalog_root, file_id)
    _write_instrument_parquets(catalog_root, instrument_id, stored)
    return item


def load_minute_bars(catalog_root: Path, instrument_id: str) -> pd.DataFrame:
    path = _bars_path(catalog_root, instrument_id)
    if not path.exists():
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume", "trade_count"])
    return pd.read_parquet(path)


def load_trades(catalog_root: Path, instrument_id: str) -> pd.DataFrame:
    path = _trades_path(catalog_root, instrument_id)
    if not path.exists():
        return _empty_stored()
    return _ensure_file_id(pd.read_parquet(path))
