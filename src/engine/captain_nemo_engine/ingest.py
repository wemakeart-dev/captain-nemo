from __future__ import annotations

from pathlib import Path

import pandas as pd
from nautilus_trader.model.data import TradeTick
from nautilus_trader.persistence.catalog import ParquetDataCatalog
from nautilus_trader.persistence.wranglers import TradeTickDataWrangler

from captain_nemo_engine.bars import aggregate_bars
from captain_nemo_engine.catalog_index import upsert_instrument
from captain_nemo_engine.csv_loader import instrument_id_from_symbol, iter_trade_chunks, symbol_from_path
from captain_nemo_engine.instruments import perpetual_from_trades

BARS_DIRNAME = "nemo_bars"
TRADES_DIRNAME = "nemo_trades"
STORED_COLUMNS = ["trade_id", "price", "quantity", "quote_qty", "buyer_maker", "ts_event_ns"]


def _bars_path(catalog_root: Path, instrument_id: str) -> Path:
    safe = instrument_id.replace("/", "-")
    return catalog_root / BARS_DIRNAME / f"{safe}.parquet"


def _trades_path(catalog_root: Path, instrument_id: str) -> Path:
    safe = instrument_id.replace("/", "-")
    return catalog_root / TRADES_DIRNAME / f"{safe}.parquet"


def _empty_stored() -> pd.DataFrame:
    return pd.DataFrame(columns=STORED_COLUMNS)


def _datetime_index_to_ns(index: pd.Index) -> pd.Series:
    dt = pd.DatetimeIndex(index)
    if dt.tz is None:
        dt = dt.tz_localize("UTC")
    else:
        dt = dt.tz_convert("UTC")
    return pd.Series(dt.as_unit("ns").astype("int64"), index=index)


def _stored_from_chunks(trades: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "trade_id": trades["trade_id"].astype(str),
            "price": trades["price"].astype(str),
            "quantity": trades["quantity"].astype(str),
            "quote_qty": trades["quote_qty"].astype(str),
            "buyer_maker": trades["buyer_maker"].astype(bool),
            "ts_event_ns": _datetime_index_to_ns(trades.index),
        }
    )


def _merge_stored(existing: pd.DataFrame, incoming: pd.DataFrame) -> pd.DataFrame:
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


def import_csv(path: Path, catalog_root: Path, instrument_id: str = "", chunksize: int = 100_000) -> dict:
    path = path.resolve()
    if not path.is_file():
        raise FileNotFoundError(str(path))
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
    incoming = _stored_from_chunks(pd.concat(trade_frames, axis=0).sort_index())
    stored = _merge_stored(load_trades(catalog_root, resolved_id), incoming)
    _write_new_ticks(catalog, resolved_id, ticks)
    bars_source = stored.copy()
    bars_source.index = pd.to_datetime(bars_source["ts_event_ns"], utc=True, unit="ns")
    minute_bars = aggregate_bars(bars_source, "1m")
    _bars_path(catalog_root, resolved_id).parent.mkdir(parents=True, exist_ok=True)
    _trades_path(catalog_root, resolved_id).parent.mkdir(parents=True, exist_ok=True)
    minute_bars.to_parquet(_bars_path(catalog_root, resolved_id))
    stored.to_parquet(_trades_path(catalog_root, resolved_id), index=False)
    item = {
        "instrument_id": resolved_id,
        "symbol": symbol,
        "start_ns": int(stored["ts_event_ns"].min()),
        "end_ns": int(stored["ts_event_ns"].max()),
        "trade_count": int(len(stored)),
        "source_path": str(path),
    }
    upsert_instrument(catalog_root, item)
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
    return pd.read_parquet(path)
