from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import date
from pathlib import Path

from captain_nemo_engine.vision.dates import daily_specs as _daily_specs
from captain_nemo_engine.vision.dates import monthly_specs as _monthly_specs
from captain_nemo_engine.vision.fetch import materialize, materialize_many
from captain_nemo_engine.vision.http import Opener
from captain_nemo_engine.vision.spec import VisionSpec, vision_spec

DATASET = "aggTrades"


def spec(trading_type: str, symbol: str, granularity: str, period: str) -> VisionSpec:
    return vision_spec(trading_type, DATASET, granularity, symbol, period)


def download(
    item: VisionSpec,
    dest_root: Path,
    *,
    checksum: bool = True,
    opener: Opener | None = None,
) -> Path:
    return materialize(item, dest_root, checksum=checksum, opener=opener)


def monthly_specs(
    trading_type: str,
    symbols: Iterable[str],
    years: Sequence[int | str],
    months: Sequence[int] | None = None,
    start: date | str | None = None,
    end: date | str | None = None,
) -> list[VisionSpec]:
    return _monthly_specs(trading_type, DATASET, symbols, years, months or tuple(range(1, 13)), start, end)


def daily_specs(
    trading_type: str,
    symbols: Iterable[str],
    dates: Sequence[str | date] | None = None,
    start: date | str | None = None,
    end: date | str | None = None,
) -> list[VisionSpec]:
    return _daily_specs(trading_type, DATASET, symbols, dates, start, end)


def download_monthly(
    trading_type: str,
    symbols: Iterable[str],
    years: Sequence[int | str],
    dest_root: Path,
    months: Sequence[int] | None = None,
    start: date | str | None = None,
    end: date | str | None = None,
    *,
    checksum: bool = True,
    opener: Opener | None = None,
) -> list[Path]:
    return materialize_many(
        monthly_specs(trading_type, symbols, years, months, start, end),
        dest_root,
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
    *,
    checksum: bool = True,
    opener: Opener | None = None,
) -> list[Path]:
    return materialize_many(
        daily_specs(trading_type, symbols, dates, start, end),
        dest_root,
        checksum=checksum,
        opener=opener,
    )
