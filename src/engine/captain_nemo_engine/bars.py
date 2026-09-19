from __future__ import annotations

import pandas as pd

STEP_TO_FREQ = {
    "1s": "1s",
    "1m": "1min",
    "5m": "5min",
    "15m": "15min",
    "1h": "1h",
}


def aggregate_bars(trades: pd.DataFrame, step: str) -> pd.DataFrame:
    if step not in STEP_TO_FREQ:
        raise ValueError(f"unsupported bar step: {step}")
    if trades.empty:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume", "trade_count"])
    frame = pd.DataFrame(
        {
            "price": trades["price"].astype("float64"),
            "quantity": trades["quantity"].astype("float64"),
        },
        index=pd.DatetimeIndex(trades.index),
    )
    grouped = frame.resample(STEP_TO_FREQ[step])
    bars = grouped["price"].ohlc()
    bars["volume"] = grouped["quantity"].sum()
    bars["trade_count"] = grouped["price"].count()
    bars = bars.dropna(subset=["open", "high", "low", "close"])
    bars["trade_count"] = bars["trade_count"].fillna(0).astype("int64")
    return bars


def resample_bars(bars: pd.DataFrame, step: str) -> pd.DataFrame:
    if step not in STEP_TO_FREQ:
        raise ValueError(f"unsupported bar step: {step}")
    if bars.empty:
        return bars
    frame = bars.copy()
    grouped = frame.resample(STEP_TO_FREQ[step])
    out = pd.DataFrame(
        {
            "open": grouped["open"].first(),
            "high": grouped["high"].max(),
            "low": grouped["low"].min(),
            "close": grouped["close"].last(),
            "volume": grouped["volume"].sum(),
            "trade_count": grouped["trade_count"].sum(),
        }
    )
    return out.dropna(subset=["open", "high", "low", "close"])
