from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable

import pandas as pd

from captain_nemo_engine.bars import resample_bars
from captain_nemo_engine.ingest import load_minute_bars, load_trades
from captain_nemo_engine.paths import ensure_generated_path

ensure_generated_path()

from captain_nemo.v1 import wire_pb2 as wire
from captain_nemo_engine.wire import new_frame

Send = Callable[[bytes], Awaitable[None]]
TAPE_LIMIT = 200


def bars_to_proto(instrument_id: str, step: str, bars: pd.DataFrame, snapshot: bool) -> bytes:
    frame = new_frame()
    batch = frame.bars
    batch.instrument_id = instrument_id
    batch.bar_step = step
    batch.snapshot = snapshot
    for ts, row in bars.iterrows():
        bar = batch.bars.add()
        bar.ts_event_ns = int(pd.Timestamp(ts).value)
        bar.open = _decimal_string(row["open"])
        bar.high = _decimal_string(row["high"])
        bar.low = _decimal_string(row["low"])
        bar.close = _decimal_string(row["close"])
        bar.volume = _decimal_string(row["volume"])
        bar.trade_count = int(row["trade_count"])
    return frame.SerializeToString()


def trades_to_proto(instrument_id: str, trades: pd.DataFrame) -> bytes:
    frame = new_frame()
    batch = frame.trades
    batch.instrument_id = instrument_id
    for _, row in trades.iterrows():
        trade = batch.trades.add()
        trade.id = int(str(row["trade_id"]).split(".")[0] or "0")
        trade.price = str(row["price"])
        trade.qty = str(row["quantity"])
        trade.quote_qty = str(row["quote_qty"])
        trade.ts_event_ns = int(row["ts_event_ns"])
        trade.is_buyer_maker = bool(row["buyer_maker"])
    return frame.SerializeToString()


def playback_state_frame(
    instrument_id: str,
    cursor_ns: int,
    speed: float,
    playing: bool,
    start_ns: int,
    end_ns: int,
) -> bytes:
    frame = new_frame()
    state = frame.playback
    state.instrument_id = instrument_id
    state.cursor_ns = cursor_ns
    state.speed = speed
    state.playing = playing
    state.start_ns = start_ns
    state.end_ns = end_ns
    return frame.SerializeToString()


def _decimal_string(value: object) -> str:
    text = format(float(value), ".10f").rstrip("0").rstrip(".")
    return text if text else "0"


def filter_range(bars: pd.DataFrame, start_ns: int, end_ns: int) -> pd.DataFrame:
    if bars.empty:
        return bars
    start = pd.Timestamp(start_ns, unit="ns", tz="UTC") if start_ns else bars.index.min()
    end = pd.Timestamp(end_ns, unit="ns", tz="UTC") if end_ns else bars.index.max()
    return bars.loc[(bars.index >= start) & (bars.index <= end)]


class PlaybackController:
    def __init__(self, catalog_root, send: Send) -> None:
        self._catalog_root = catalog_root
        self._send = send
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self.speed = 1.0
        self.playing = False

    async def stop(self) -> None:
        self.playing = False
        self._stop.set()
        if self._task is not None:
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    async def start(self, instrument_id: str, start_ns: int, end_ns: int, speed: float, bar_step: str) -> None:
        await self.stop()
        self.speed = speed if speed > 0 else 1.0
        self._stop = asyncio.Event()
        self.playing = True
        self._task = asyncio.create_task(
            self._run(instrument_id, start_ns, end_ns, bar_step),
            name="nemo-playback",
        )

    async def _run(self, instrument_id: str, start_ns: int, end_ns: int, bar_step: str) -> None:
        minute = load_minute_bars(self._catalog_root, instrument_id)
        bars = resample_bars(filter_range(minute, start_ns, end_ns), bar_step)
        trades = load_trades(self._catalog_root, instrument_id)
        if bars.empty:
            self.playing = False
            return
        start_value = int(bars.index[0].value)
        end_value = int(bars.index[-1].value)
        timestamps = [int(ts.value) for ts in bars.index]
        wall0 = time.monotonic()
        index = 0
        last_trade_pos = 0
        try:
            while index < len(bars) and not self._stop.is_set():
                elapsed = time.monotonic() - wall0
                cursor = start_value + int(elapsed * self.speed * 1_000_000_000)
                emitted = []
                while index < len(timestamps) and timestamps[index] <= cursor:
                    emitted.append(index)
                    index += 1
                if emitted:
                    slice_bars = bars.iloc[emitted[0] : emitted[-1] + 1]
                    await self._send(bars_to_proto(instrument_id, bar_step, slice_bars, False))
                    if not trades.empty:
                        window_end = timestamps[emitted[-1]]
                        mask = (trades["ts_event_ns"] > last_trade_pos) & (trades["ts_event_ns"] <= window_end)
                        tape = trades.loc[mask].tail(TAPE_LIMIT)
                        if not tape.empty:
                            await self._send(trades_to_proto(instrument_id, tape))
                        last_trade_pos = window_end
                    await self._send(
                        playback_state_frame(instrument_id, cursor, self.speed, True, start_value, end_value)
                    )
                else:
                    await asyncio.sleep(0.016)
            if not self._stop.is_set():
                await self._send(
                    playback_state_frame(instrument_id, end_value, self.speed, False, start_value, end_value)
                )
        finally:
            self.playing = False
