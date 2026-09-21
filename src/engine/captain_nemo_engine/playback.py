from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from captain_nemo_engine.bars import resample_bars
from captain_nemo_engine.console import log_error
from captain_nemo_engine.ingest import bars_parquet_path, load_minute_bars, load_trades, trades_parquet_path
from captain_nemo_engine.paths import ensure_generated_path

ensure_generated_path()

from captain_nemo.v1 import wire_pb2 as wire
from captain_nemo_engine.wire import error_frame, new_frame

Send = Callable[[bytes], Awaitable[None]]
Monotonic = Callable[[], float]
Sleep = Callable[[float], Awaitable[None]]

TAPE_LIMIT = 200
BARS_PER_TICK = 256
TICK_S = 0.033
NS = 1_000_000_000


class PlaybackError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(slots=True)
class PlaybackTape:
    instrument_id: str
    bar_step: str
    bars: pd.DataFrame
    bar_ts: np.ndarray
    trades: pd.DataFrame
    trade_ts: np.ndarray
    key: tuple


def datetime_index_ns(index: pd.Index) -> np.ndarray:
    if len(index) == 0:
        return np.empty(0, dtype=np.int64)
    dt = pd.DatetimeIndex(index)
    if dt.tz is None:
        dt = dt.tz_localize("UTC")
    else:
        dt = dt.tz_convert("UTC")
    return np.asarray(dt.as_unit("ns").astype("int64"), dtype=np.int64)


def trade_window_slice(trade_ts: np.ndarray, last_ns: int, cursor_ns: int, limit: int = TAPE_LIMIT) -> slice:
    if trade_ts.size == 0 or cursor_ns <= last_ns:
        return slice(0, 0)
    left = int(np.searchsorted(trade_ts, last_ns, side="right"))
    right = int(np.searchsorted(trade_ts, cursor_ns, side="right"))
    if right <= left:
        return slice(0, 0)
    return slice(max(left, right - limit), right)


def build_tape(instrument_id: str, bar_step: str, bars: pd.DataFrame, trades: pd.DataFrame, key: tuple) -> PlaybackTape:
    trade_frame = trades
    if trade_frame is None or trade_frame.empty:
        trade_frame = pd.DataFrame(columns=["trade_id", "price", "quantity", "quote_qty", "buyer_maker", "ts_event_ns"])
        trade_ts = np.empty(0, dtype=np.int64)
    else:
        trade_frame = trade_frame.sort_values("ts_event_ns").reset_index(drop=True)
        trade_ts = trade_frame["ts_event_ns"].to_numpy(dtype=np.int64, copy=True)
    return PlaybackTape(
        instrument_id=instrument_id,
        bar_step=bar_step,
        bars=bars,
        bar_ts=datetime_index_ns(bars.index) if not bars.empty else np.empty(0, dtype=np.int64),
        trades=trade_frame,
        trade_ts=trade_ts,
        key=key,
    )


def bars_to_proto(instrument_id: str, step: str, bars: pd.DataFrame, snapshot: bool) -> bytes:
    frame = new_frame()
    batch = frame.bars
    batch.instrument_id = instrument_id
    batch.bar_step = step
    batch.snapshot = snapshot
    if bars.empty:
        return frame.SerializeToString()
    ts_ns = datetime_index_ns(bars.index)
    opens = bars["open"].to_numpy()
    highs = bars["high"].to_numpy()
    lows = bars["low"].to_numpy()
    closes = bars["close"].to_numpy()
    volumes = bars["volume"].to_numpy()
    counts = bars["trade_count"].to_numpy()
    for i in range(len(bars)):
        bar = batch.bars.add()
        bar.ts_event_ns = int(ts_ns[i])
        bar.open = _decimal_string(opens[i])
        bar.high = _decimal_string(highs[i])
        bar.low = _decimal_string(lows[i])
        bar.close = _decimal_string(closes[i])
        bar.volume = _decimal_string(volumes[i])
        bar.trade_count = int(counts[i])
    return frame.SerializeToString()


def trades_to_proto(instrument_id: str, trades: pd.DataFrame) -> bytes:
    frame = new_frame()
    batch = frame.trades
    batch.instrument_id = instrument_id
    if trades.empty:
        return frame.SerializeToString()
    ids = trades["trade_id"].to_numpy()
    prices = trades["price"].to_numpy()
    qtys = trades["quantity"].to_numpy()
    quotes = trades["quote_qty"].to_numpy()
    ts_ns = trades["ts_event_ns"].to_numpy()
    makers = trades["buyer_maker"].to_numpy()
    for i in range(len(trades)):
        trade = batch.trades.add()
        trade.id = int(str(ids[i]).split(".")[0] or "0")
        trade.price = str(prices[i])
        trade.qty = str(qtys[i])
        trade.quote_qty = str(quotes[i])
        trade.ts_event_ns = int(ts_ns[i])
        trade.is_buyer_maker = bool(makers[i])
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


def query_bars_payload(
    catalog_root: Path,
    instrument_id: str,
    start_ns: int,
    end_ns: int,
    bar_step: str,
) -> tuple[int, bytes | None]:
    minute = load_minute_bars(catalog_root, instrument_id)
    if minute.empty:
        raise PlaybackError("UNKNOWN_INSTRUMENT", instrument_id)
    bars = resample_bars(filter_range(minute, start_ns, end_ns), bar_step)
    snapshot = bars_to_proto(instrument_id, bar_step, bars, True) if not bars.empty else None
    return len(bars), snapshot


def _mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return -1.0


class PlaybackController:
    def __init__(
        self,
        catalog_root: Path | None,
        send: Send,
        *,
        monotonic: Monotonic = time.monotonic,
        sleep: Sleep | None = None,
    ) -> None:
        self._catalog_root = Path(catalog_root) if catalog_root is not None else None
        self._send = send
        self._monotonic = monotonic
        self._sleep = sleep or asyncio.sleep
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self._tape: PlaybackTape | None = None
        self._memory = False
        self._sim0 = 0
        self._wall0 = 0.0
        self._bar_index = 0
        self._last_trade_ns = 0
        self._range_hi = 0
        self._snapshot_key: tuple | None = None
        self.speed = 1.0
        self.playing = False
        self.instrument_id = ""
        self.bar_step = "1m"
        self.cursor_ns = 0
        self.start_ns = 0
        self.end_ns = 0

    def load_memory(self, instrument_id: str, bar_step: str, bars: pd.DataFrame, trades: pd.DataFrame) -> None:
        self._memory = True
        self._tape = build_tape(instrument_id, bar_step, bars, trades, ("memory", instrument_id, bar_step))

    def mark_snapshot(self, key: tuple | None = None) -> None:
        if key is not None:
            self._snapshot_key = key
            return
        if self._tape is not None:
            self._snapshot_key = self._tape.key

    async def warm(self, instrument_id: str, bar_step: str) -> PlaybackTape:
        tape = await self._ensure_tape(instrument_id, bar_step)
        self.mark_snapshot(tape.key)
        return tape

    def _should_send_bar_deltas(self) -> bool:
        tape = self._tape
        if tape is None or self._snapshot_key is None:
            return True
        return self._snapshot_key != tape.key

    def state_frame(self) -> bytes:
        return playback_state_frame(
            self.instrument_id,
            self.cursor_ns,
            self.speed,
            self.playing,
            self.start_ns,
            self.end_ns,
        )

    def set_speed(self, speed: float) -> None:
        if self.playing:
            self.cursor_ns = self._cursor_now()
        self.speed = speed if speed > 0 else 1.0
        self._arm_clock()

    async def stop(self, *, emit: bool = True) -> None:
        if self.playing:
            self.cursor_ns = self._cursor_now()
        self.playing = False
        self._stop.set()
        task = self._task
        self._task = None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception as exc:
                log_error(f"playback task: {exc}")
        if emit and self.instrument_id:
            try:
                await self._send(self.state_frame())
            except Exception:
                pass

    def rewind(self) -> None:
        self.playing = False
        if self.start_ns:
            self.cursor_ns = self.start_ns
        tape = self._tape
        if tape is None:
            self._bar_index = 0
            self._last_trade_ns = self.cursor_ns - 1 if self.cursor_ns else 0
            return
        bar_ts = tape.bar_ts
        self._bar_index = int(np.searchsorted(bar_ts, self.cursor_ns, side="left")) if bar_ts.size else 0
        self._last_trade_ns = self.cursor_ns - 1 if self.cursor_ns else 0

    def range_bars(self) -> pd.DataFrame:
        tape = self._tape
        if tape is None or tape.bars.empty:
            return pd.DataFrame(columns=["open", "high", "low", "close", "volume", "trade_count"])
        start = int(np.searchsorted(tape.bar_ts, self.start_ns, side="left")) if self.start_ns else 0
        end = self._range_hi if self._range_hi else tape.bar_ts.size
        if start >= end:
            return tape.bars.iloc[0:0]
        return tape.bars.iloc[start:end]

    async def reset(self) -> None:
        await self.stop(emit=False)
        self.rewind()
        if not self.instrument_id:
            return
        try:
            await self._send(self.state_frame())
            empty = pd.DataFrame(columns=["trade_id", "price", "quantity", "quote_qty", "buyer_maker", "ts_event_ns"])
            await self._send(trades_to_proto(self.instrument_id, empty))
        except Exception:
            pass

    async def prepare(self, instrument_id: str, start_ns: int, end_ns: int, speed: float, bar_step: str) -> str:
        if self.playing:
            return "noop"
        self.speed = speed if speed > 0 else 1.0
        tape = await self._ensure_tape(instrument_id, bar_step)
        if self._can_resume(instrument_id, bar_step, start_ns, tape):
            return "resume"
        self._bind_session(tape, start_ns, end_ns)
        return "start"

    def launch(self) -> None:
        if self.playing and self._task is not None and not self._task.done():
            return
        if self._tape is None:
            return
        self._stop = asyncio.Event()
        self.playing = True
        self._arm_clock()
        self._task = asyncio.create_task(self._guarded_run(), name="nemo-playback")

    async def start(self, instrument_id: str, start_ns: int, end_ns: int, speed: float, bar_step: str) -> str:
        mode = await self.prepare(instrument_id, start_ns, end_ns, speed, bar_step)
        if mode != "noop":
            self.launch()
        return mode

    def _can_resume(self, instrument_id: str, bar_step: str, start_ns: int, tape: PlaybackTape) -> bool:
        if self.instrument_id != instrument_id or self.bar_step != bar_step:
            return False
        if self.cursor_ns <= 0 or self.cursor_ns >= self.end_ns:
            return False
        if self._tape is None or tape.key != self._tape.key:
            return False
        return start_ns == 0 or start_ns == self.cursor_ns

    async def _ensure_tape(self, instrument_id: str, bar_step: str) -> PlaybackTape:
        if self._memory:
            if self._tape is None or self._tape.instrument_id != instrument_id or self._tape.bar_step != bar_step:
                raise PlaybackError("UNKNOWN_INSTRUMENT", instrument_id)
            return self._tape
        if self._catalog_root is None:
            raise PlaybackError("UNKNOWN_INSTRUMENT", instrument_id)
        key = (
            instrument_id,
            bar_step,
            _mtime(bars_parquet_path(self._catalog_root, instrument_id)),
            _mtime(trades_parquet_path(self._catalog_root, instrument_id)),
        )
        if self._tape is not None and self._tape.key == key:
            return self._tape
        return await asyncio.to_thread(self._load_tape, instrument_id, bar_step, key)

    def _load_tape(self, instrument_id: str, bar_step: str, key: tuple) -> PlaybackTape:
        assert self._catalog_root is not None
        minute = load_minute_bars(self._catalog_root, instrument_id)
        if minute.empty:
            raise PlaybackError("UNKNOWN_INSTRUMENT", instrument_id)
        bars = resample_bars(minute, bar_step)
        if bars.empty:
            raise PlaybackError("UNKNOWN_INSTRUMENT", "no bars in range")
        trades = load_trades(self._catalog_root, instrument_id)
        return build_tape(instrument_id, bar_step, bars, trades, key)

    def _bind_session(self, tape: PlaybackTape, start_ns: int, end_ns: int) -> None:
        bar_ts = tape.bar_ts
        if bar_ts.size == 0:
            raise PlaybackError("UNKNOWN_INSTRUMENT", "no bars in range")
        lo = int(np.searchsorted(bar_ts, start_ns, side="left")) if start_ns else 0
        hi = int(np.searchsorted(bar_ts, end_ns, side="right")) if end_ns else bar_ts.size
        if lo >= hi:
            raise PlaybackError("UNKNOWN_INSTRUMENT", "no bars in range")
        range_start = int(bar_ts[lo])
        range_end = int(bar_ts[hi - 1])
        if tape.trade_ts.size:
            last_trade = int(tape.trade_ts[tape.trade_ts.size - 1])
            if last_trade > range_end:
                range_end = last_trade
        self._tape = tape
        self.instrument_id = tape.instrument_id
        self.bar_step = tape.bar_step
        self.start_ns = range_start
        self.end_ns = range_end
        self._range_hi = hi
        if start_ns and start_ns > range_start:
            self.cursor_ns = min(start_ns, range_end)
        else:
            self.cursor_ns = range_start
        self._bar_index = int(np.searchsorted(bar_ts, self.cursor_ns, side="left"))
        self._last_trade_ns = self.cursor_ns - 1 if self.cursor_ns else 0

    def _arm_clock(self) -> None:
        self._sim0 = self.cursor_ns
        self._wall0 = self._monotonic()

    def _cursor_now(self) -> int:
        if not self.playing:
            return self.cursor_ns
        elapsed = self._monotonic() - self._wall0
        cursor = self._sim0 + int(elapsed * self.speed * NS)
        if cursor < self.start_ns:
            return self.start_ns
        if cursor > self.end_ns:
            return self.end_ns
        return cursor

    async def _guarded_run(self) -> None:
        try:
            await self._run()
        except asyncio.CancelledError:
            return
        except Exception as exc:
            self.playing = False
            log_error(f"playback failed: {exc}")
            try:
                await self._send(error_frame(0, "PLAYBACK_FAILED", str(exc)))
            except Exception:
                pass
        finally:
            self.playing = False

    async def _run(self) -> None:
        await self._send(self.state_frame())
        while not self._stop.is_set():
            cursor = self._cursor_now()
            self.cursor_ns = cursor
            n_bars = await self._send_due_bars(cursor)
            await self._send_due_trades(cursor)
            finishing = cursor >= self.end_ns
            if finishing:
                self.playing = False
                self.cursor_ns = self.end_ns
            await self._send(self.state_frame())
            if finishing or self._stop.is_set():
                return
            if n_bars >= BARS_PER_TICK:
                await self._sleep(0)
            else:
                await self._sleep(self._sleep_s(cursor))

    def _sleep_s(self, cursor: int) -> float:
        tape = self._tape
        if tape is not None and self._bar_index < self._range_hi:
            wait_ns = max(0, int(tape.bar_ts[self._bar_index]) - cursor)
        else:
            wait_ns = max(0, self.end_ns - cursor)
        if wait_ns <= 0 or self.speed <= 0:
            return 0.0
        return min(TICK_S, wait_ns / (self.speed * NS))

    async def _send_due_bars(self, cursor: int) -> int:
        tape = self._tape
        if tape is None:
            return 0
        start = self._bar_index
        end = start
        send_bars = self._should_send_bar_deltas()
        limit = min(self._range_hi, start + BARS_PER_TICK) if send_bars else self._range_hi
        while end < limit and int(tape.bar_ts[end]) <= cursor:
            end += 1
        if end <= start:
            return 0
        self._bar_index = end
        if send_bars:
            await self._send(bars_to_proto(self.instrument_id, self.bar_step, tape.bars.iloc[start:end], False))
        return end - start

    async def _send_due_trades(self, cursor: int) -> None:
        tape = self._tape
        if tape is None or tape.trade_ts.size == 0:
            self._last_trade_ns = cursor
            return
        window = trade_window_slice(tape.trade_ts, self._last_trade_ns, cursor, TAPE_LIMIT)
        self._last_trade_ns = cursor
        if window.start == window.stop:
            return
        await self._send(trades_to_proto(self.instrument_id, tape.trades.iloc[window]))
