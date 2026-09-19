from __future__ import annotations

from pathlib import Path

import pandas as pd

TRADE_COLUMNS = ["id", "price", "qty", "quote_qty", "time", "is_buyer_maker"]
_HEADER_ALIASES = {
    "id": "id",
    "price": "price",
    "qty": "qty",
    "quote_qty": "quote_qty",
    "quoteqty": "quote_qty",
    "time": "time",
    "is_buyer_maker": "is_buyer_maker",
    "isbuyermaker": "is_buyer_maker",
}


def has_header(path: Path) -> bool:
    with path.open(newline="", encoding="utf-8") as handle:
        first = handle.readline().strip().lstrip("\ufeff")
    lowered = first.lower().replace(" ", "")
    return lowered.startswith("id,")


def symbol_from_path(path: Path) -> str:
    name = path.name
    marker = "-trades-"
    if marker not in name:
        raise ValueError(f"unsupported trades filename: {path.name}")
    return name.split(marker, 1)[0]


def instrument_id_from_symbol(symbol: str) -> str:
    return f"{symbol}-PERP.BINANCE"


def iter_trade_chunks(path: Path, chunksize: int = 100_000):
    headered = has_header(path)
    reader = pd.read_csv(
        path,
        header=0 if headered else None,
        names=None if headered else TRADE_COLUMNS,
        chunksize=chunksize,
        dtype=str,
    )
    for chunk in reader:
        yield normalize_trades(chunk)


def read_trades_csv(path: Path) -> pd.DataFrame:
    frames = list(iter_trade_chunks(path))
    if not frames:
        return pd.DataFrame(columns=["trade_id", "price", "quantity", "quote_qty", "buyer_maker"])
    return pd.concat(frames, axis=0)


def normalize_trades(frame: pd.DataFrame) -> pd.DataFrame:
    renamed = {}
    for column in frame.columns:
        key = str(column).strip().lower().replace(" ", "")
        if key in _HEADER_ALIASES:
            renamed[column] = _HEADER_ALIASES[key]
    data = frame.rename(columns=renamed)
    missing = [name for name in TRADE_COLUMNS if name not in data.columns]
    if missing:
        raise ValueError(f"trades csv missing columns: {missing}")
    out = pd.DataFrame(index=data.index)
    out["trade_id"] = data["id"].astype(str)
    out["price"] = data["price"].astype(str)
    out["quantity"] = data["qty"].astype(str)
    out["quote_qty"] = data["quote_qty"].astype(str)
    out["buyer_maker"] = (
        data["is_buyer_maker"].astype(str).str.strip().str.lower().isin(["true", "1", "t", "yes"])
    )
    timestamps = pd.to_datetime(pd.to_numeric(data["time"], errors="raise"), unit="ms", utc=True)
    out.index = timestamps
    out.index.name = "timestamp"
    return out
