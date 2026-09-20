from __future__ import annotations

import re
from dataclasses import dataclass

from captain_nemo_engine.vision.constants import (
    BASE_URL,
    DATASETS,
    FUTURES_ONLY_DATASETS,
    GRANULARITIES,
    INTERVALS,
    KLINE_DATASETS,
    TICK_DATASETS,
    TRADING_TYPES,
)

SYMBOL_RE = re.compile(r"^[A-Z0-9_-]{1,32}$")
DAILY_DISPLAY = re.compile(r"^(\d{2})-(\d{2})-(\d{4})$")
MONTHLY_DISPLAY = re.compile(r"^(\d{2})-(\d{4})$")
ISO_DAILY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
ISO_MONTHLY = re.compile(r"^(\d{4})-(\d{2})$")


class VisionError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def canonical_trading_type(value: str) -> str:
    trading = (value or "").strip().lower()
    if trading not in TRADING_TYPES:
        raise VisionError("IMPORT_FAILED", f"unsupported trading type: {value}")
    return trading


def canonical_dataset(value: str) -> str:
    dataset = (value or "").strip()
    match = {item.lower(): item for item in DATASETS}
    key = dataset.lower()
    if key not in match:
        raise VisionError("IMPORT_FAILED", f"unsupported dataset: {value}")
    return match[key]


def canonical_granularity(value: str) -> str:
    granularity = (value or "").strip().lower()
    if granularity not in GRANULARITIES:
        raise VisionError("IMPORT_FAILED", f"unsupported granularity: {value}")
    return granularity


def canonical_symbol(value: str) -> str:
    symbol = (value or "").strip().upper()
    if not SYMBOL_RE.match(symbol):
        raise VisionError("IMPORT_FAILED", f"invalid symbol: {value}")
    return symbol


def canonical_interval(value: str | None) -> str:
    interval = (value or "").strip()
    if interval not in INTERVALS:
        raise VisionError("IMPORT_FAILED", f"unsupported interval: {value}")
    return interval


def period_iso(granularity: str, period: str) -> str:
    gran = canonical_granularity(granularity)
    text = (period or "").strip()
    if gran == "daily":
        daily = DAILY_DISPLAY.match(text)
        if daily:
            return f"{daily.group(3)}-{daily.group(2)}-{daily.group(1)}"
        iso = ISO_DAILY.match(text)
        if iso:
            return f"{iso.group(1)}-{iso.group(2)}-{iso.group(3)}"
        raise VisionError("IMPORT_FAILED", f"daily period must be DD-MM-YYYY: {period}")
    monthly = MONTHLY_DISPLAY.match(text)
    if monthly:
        return f"{monthly.group(2)}-{monthly.group(1)}"
    iso = ISO_MONTHLY.match(text)
    if iso:
        return f"{iso.group(1)}-{iso.group(2)}"
    raise VisionError("IMPORT_FAILED", f"monthly period must be MM-YYYY: {period}")


@dataclass(frozen=True)
class VisionSpec:
    trading_type: str
    dataset: str
    granularity: str
    symbol: str
    period: str
    interval: str | None = None

    @property
    def relative_dir(self) -> str:
        if self.trading_type == "spot":
            root = "data/spot"
        else:
            root = f"data/futures/{self.trading_type}"
        path = f"{root}/{self.granularity}/{self.dataset}/{self.symbol}/"
        if self.interval is not None:
            path = f"{path}{self.interval}/"
        return path

    @property
    def archive_name(self) -> str:
        if self.dataset in TICK_DATASETS:
            return f"{self.symbol}-{self.dataset}-{self.period}.zip"
        return f"{self.symbol}-{self.interval}-{self.period}.zip"

    @property
    def checksum_name(self) -> str:
        return f"{self.archive_name}.CHECKSUM"

    @property
    def relative_path(self) -> str:
        return f"{self.relative_dir}{self.archive_name}"

    @property
    def download_url(self) -> str:
        return f"{BASE_URL}{self.relative_path}"

    @property
    def checksum_url(self) -> str:
        return f"{BASE_URL}{self.relative_dir}{self.checksum_name}"


def vision_spec(
    trading_type: str,
    dataset: str,
    granularity: str,
    symbol: str,
    period: str,
    interval: str | None = None,
) -> VisionSpec:
    trading = canonical_trading_type(trading_type)
    data = canonical_dataset(dataset)
    gran = canonical_granularity(granularity)
    name = canonical_symbol(symbol)
    iso = period_iso(gran, period)
    if data in FUTURES_ONLY_DATASETS and trading == "spot":
        raise VisionError("IMPORT_FAILED", f"{data} is futures-only")
    resolved_interval: str | None = None
    if data in KLINE_DATASETS:
        resolved_interval = canonical_interval(interval)
    elif interval:
        raise VisionError("IMPORT_FAILED", f"{data} does not take a kline interval")
    return VisionSpec(
        trading_type=trading,
        dataset=data,
        granularity=gran,
        symbol=name,
        period=iso,
        interval=resolved_interval,
    )
