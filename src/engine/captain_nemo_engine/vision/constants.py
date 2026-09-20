from __future__ import annotations

from datetime import date

BASE_URL = "https://data.binance.vision/"
TRADING_TYPES = ("spot", "um", "cm")
GRANULARITIES = ("daily", "monthly")
DATASETS = (
    "aggTrades",
    "klines",
    "trades",
    "indexPriceKlines",
    "markPriceKlines",
    "premiumIndexKlines",
)
TICK_DATASETS = frozenset({"trades", "aggTrades"})
KLINE_DATASETS = frozenset({"klines", "indexPriceKlines", "markPriceKlines", "premiumIndexKlines"})
FUTURES_ONLY_DATASETS = frozenset({"indexPriceKlines", "markPriceKlines", "premiumIndexKlines"})
INTERVALS = ("1s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1mo")
DAILY_INTERVALS = ("1s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d")
MONTHS = tuple(range(1, 13))
START_YEAR = 2017
PERIOD_START_DATE = date(2020, 1, 1)
START_DATE = date(START_YEAR, 1, 1)


def available_years(today: date | None = None) -> tuple[str, ...]:
    current = (today or date.today()).year
    return tuple(str(year) for year in range(START_YEAR, current + 1))
