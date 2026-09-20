from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import date, timedelta

from captain_nemo_engine.vision.constants import DAILY_INTERVALS, MONTHS, PERIOD_START_DATE, START_DATE
from captain_nemo_engine.vision.spec import DAILY_DISPLAY, ISO_DAILY, VisionSpec, period_iso, vision_spec


def parse_iso_date(value: str | date) -> date:
    if isinstance(value, date):
        return value
    year, month, day = (int(part) for part in period_iso("daily", str(value)).split("-"))
    return date(year, month, day)


def parse_iso_month(value: str | date) -> date:
    if isinstance(value, date):
        return date(value.year, value.month, 1)
    iso = period_iso("monthly", str(value))
    year, month = (int(part) for part in iso.split("-"))
    return date(year, month, 1)


def parse_bound(value: str | date) -> date:
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if DAILY_DISPLAY.match(text) or ISO_DAILY.match(text):
        return parse_iso_date(text)
    return parse_iso_month(text)


def iter_days(start: date, end: date) -> list[date]:
    if end < start:
        return []
    days: list[date] = []
    current = start
    while current <= end:
        days.append(current)
        current += timedelta(days=1)
    return days


def iter_months(start: date, end: date) -> list[date]:
    first = date(start.year, start.month, 1)
    last = date(end.year, end.month, 1)
    if last < first:
        return []
    months: list[date] = []
    year, month = first.year, first.month
    while date(year, month, 1) <= last:
        months.append(date(year, month, 1))
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1
    return months


def monthly_periods(
    years: Sequence[int | str],
    months: Sequence[int] = MONTHS,
    start: date | str | None = None,
    end: date | str | None = None,
) -> list[str]:
    start_date = parse_bound(start) if start else START_DATE
    end_date = parse_bound(end) if end else date.today()
    periods: list[str] = []
    for year in years:
        for month in months:
            current = date(int(year), int(month), 1)
            if start_date <= current <= end_date:
                periods.append(f"{current.year:04d}-{current.month:02d}")
    return periods


def daily_periods(
    dates: Sequence[str | date] | None = None,
    start: date | str | None = None,
    end: date | str | None = None,
) -> list[str]:
    start_date = parse_bound(start) if start else PERIOD_START_DATE
    end_date = parse_bound(end) if end else date.today()
    if dates is None:
        values = iter_days(start_date, end_date)
    else:
        values = [parse_iso_date(item) for item in dates]
    return [item.isoformat() for item in values if start_date <= item <= end_date]


def effective_intervals(granularity: str, intervals: Sequence[str]) -> list[str]:
    if granularity == "daily":
        allowed = set(DAILY_INTERVALS)
        return [item for item in intervals if item in allowed]
    return list(intervals)


def monthly_specs(
    trading_type: str,
    dataset: str,
    symbols: Iterable[str],
    years: Sequence[int | str],
    months: Sequence[int] = MONTHS,
    start: date | str | None = None,
    end: date | str | None = None,
    interval: str | None = None,
    intervals: Sequence[str] | None = None,
) -> list[VisionSpec]:
    specs: list[VisionSpec] = []
    chosen = [interval] if interval else list(intervals or ())
    if not chosen:
        chosen = [None]
    for symbol in symbols:
        for period in monthly_periods(years, months, start, end):
            for item in chosen:
                specs.append(vision_spec(trading_type, dataset, "monthly", symbol, period, item))
    return specs


def daily_specs(
    trading_type: str,
    dataset: str,
    symbols: Iterable[str],
    dates: Sequence[str | date] | None = None,
    start: date | str | None = None,
    end: date | str | None = None,
    interval: str | None = None,
    intervals: Sequence[str] | None = None,
) -> list[VisionSpec]:
    specs: list[VisionSpec] = []
    chosen = [interval] if interval else list(intervals or ())
    if not chosen:
        chosen = [None]
    if interval is None and intervals:
        chosen = effective_intervals("daily", chosen)
    for symbol in symbols:
        for period in daily_periods(dates, start, end):
            for item in chosen:
                specs.append(vision_spec(trading_type, dataset, "daily", symbol, period, item))
    return specs
