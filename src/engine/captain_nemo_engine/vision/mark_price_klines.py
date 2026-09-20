from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import date
from pathlib import Path

from captain_nemo_engine.vision.http import Opener
from captain_nemo_engine.vision.kline_common import (
    kline_daily_specs,
    kline_download,
    kline_download_daily,
    kline_download_monthly,
    kline_monthly_specs,
    kline_spec,
)
from captain_nemo_engine.vision.spec import VisionSpec

DATASET = "markPriceKlines"


def spec(trading_type: str, symbol: str, granularity: str, period: str, interval: str) -> VisionSpec:
    return kline_spec(DATASET, trading_type, symbol, granularity, period, interval)


def download(
    item: VisionSpec,
    dest_root: Path,
    *,
    checksum: bool = True,
    opener: Opener | None = None,
) -> Path:
    return kline_download(item, dest_root, checksum=checksum, opener=opener)


def monthly_specs(
    trading_type: str,
    symbols: Iterable[str],
    years: Sequence[int | str],
    months: Sequence[int] | None = None,
    start: date | str | None = None,
    end: date | str | None = None,
    intervals: Sequence[str] | None = None,
) -> list[VisionSpec]:
    return kline_monthly_specs(DATASET, trading_type, symbols, years, months, start, end, intervals)


def daily_specs(
    trading_type: str,
    symbols: Iterable[str],
    dates: Sequence[str | date] | None = None,
    start: date | str | None = None,
    end: date | str | None = None,
    intervals: Sequence[str] | None = None,
) -> list[VisionSpec]:
    return kline_daily_specs(DATASET, trading_type, symbols, dates, start, end, intervals)


def download_monthly(
    trading_type: str,
    symbols: Iterable[str],
    years: Sequence[int | str],
    dest_root: Path,
    months: Sequence[int] | None = None,
    start: date | str | None = None,
    end: date | str | None = None,
    intervals: Sequence[str] | None = None,
    *,
    checksum: bool = True,
    opener: Opener | None = None,
) -> list[Path]:
    return kline_download_monthly(
        DATASET,
        trading_type,
        symbols,
        years,
        dest_root,
        months,
        start,
        end,
        intervals,
        checksum=checksum,
        opener=opener,
    )


def download_daily(
    trading_type: str,
    symbols: Iterable[str],
    dest_root: Path,
    dates: Sequence[str | date] | None = None,
    start: date | str | None = None,
    end: date | str | None = None,
    intervals: Sequence[str] | None = None,
    *,
    checksum: bool = True,
    opener: Opener | None = None,
) -> list[Path]:
    return kline_download_daily(
        DATASET,
        trading_type,
        symbols,
        dest_root,
        dates,
        start,
        end,
        intervals,
        checksum=checksum,
        opener=opener,
    )
