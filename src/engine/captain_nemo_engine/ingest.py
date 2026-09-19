from __future__ import annotations

from pathlib import Path

import pandas as pd
from nautilus_trader.persistence.catalog import ParquetDataCatalog
from nautilus_trader.persistence.wranglers import TradeTickDataWrangler

from captain_nemo_engine.bars import aggregate_bars
from captain_nemo_engine.catalog_index import upsert_instrument
from captain_nemo_engine.csv_loader import instrument_id_from_symbol, iter_trade_chunks, symbol_from_path
from captain_nemo_engine.instruments import perpetual_from_trades

BARS_DIRNAME = "nemo_bars"
TRADES_DIRNAME = "nemo_trades"


def _bars_path(catalog_root: Path, instrument_id: str) -> Path:
    safe = instrument_id.replace("/", "-")
    return catalog_root / BARS_DIRNAME / f"{safe}.parquet"


def _trades_path(catalog_root: Path, instrument_id: str) -> Path:
    safe = instrument_id.replace("/", "-")
    return catalog_root / TRADES_DIRNAME / f"{safe}.parquet"


def import_csv(path: Path, catalog_root: Path, instrument_id: str = "") -> dict:
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
    bar_frames: list[pd.DataFrame] = []
    trade_count = 0
    start_ns: int | None = None
    end_ns: int | None = None
    for chunk in iter_trade_chunks(path):
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
        ticks = wrangler.process(wrangle)
        if ticks:
            catalog.write_data(ticks)
        trade_frames.append(chunk)
        bar_frames.append(aggregate_bars(chunk, "1m"))
        trade_count += len(chunk)
        first_ns = int(chunk.index[0].value)
        last_ns = int(chunk.index[-1].value)
        start_ns = first_ns if start_ns is None else min(start_ns, first_ns)
        end_ns = last_ns if end_ns is None else max(end_ns, last_ns)
    if not instrument_written or start_ns is None or end_ns is None:
        raise ValueError("no trades found in csv")
    trades = pd.concat(trade_frames, axis=0).sort_index()
    minute_bars = pd.concat(bar_frames, axis=0)
    if not minute_bars.empty:
        minute_bars = (
            minute_bars.groupby(level=0).agg(
                {
                    "open": "first",
                    "high": "max",
                    "low": "min",
                    "close": "last",
                    "volume": "sum",
                    "trade_count": "sum",
                }
            )
        )
    _bars_path(catalog_root, resolved_id).parent.mkdir(parents=True, exist_ok=True)
    _trades_path(catalog_root, resolved_id).parent.mkdir(parents=True, exist_ok=True)
    minute_bars.to_parquet(_bars_path(catalog_root, resolved_id))
    stored = pd.DataFrame(
        {
            "trade_id": trades["trade_id"].astype(str),
            "price": trades["price"].astype(str),
            "quantity": trades["quantity"].astype(str),
            "quote_qty": trades["quote_qty"].astype(str),
            "buyer_maker": trades["buyer_maker"].astype(bool),
            "ts_event_ns": trades.index.astype("int64"),
        }
    )
    stored.to_parquet(_trades_path(catalog_root, resolved_id), index=False)
    item = {
        "instrument_id": resolved_id,
        "symbol": symbol,
        "start_ns": start_ns,
        "end_ns": end_ns,
        "trade_count": trade_count,
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
        return pd.DataFrame(columns=["trade_id", "price", "quantity", "quote_qty", "buyer_maker", "ts_event_ns"])
    return pd.read_parquet(path)
