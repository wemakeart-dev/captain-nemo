from __future__ import annotations

import asyncio

import numpy as np
import pandas as pd
import pytest

from captain_nemo_engine.paths import ensure_generated_path
from captain_nemo_engine.playback import (
    NS,
    TAPE_LIMIT,
    PlaybackController,
    trade_window_slice,
)
from captain_nemo_engine.wire import decode_frame

ensure_generated_path()

START_NS = 1_785_542_400_000_000_000
MINUTE_NS = 60 * NS
INSTRUMENT = "BTCUSDC-PERP.BINANCE"


class VirtualClock:
    def __init__(self) -> None:
        self.t = 0.0
        self._waiters: list[tuple[float, asyncio.Event]] = []

    def monotonic(self) -> float:
        return self.t

    async def sleep(self, dt: float) -> None:
        if dt <= 0:
            await asyncio.sleep(0)
            return
        event = asyncio.Event()
        item = (self.t + dt, event)
        self._waiters.append(item)
        try:
            await event.wait()
        finally:
            if item in self._waiters:
                self._waiters.remove(item)

    def advance(self, dt: float) -> None:
        self.t += dt
        due: list[asyncio.Event] = []
        remaining: list[tuple[float, asyncio.Event]] = []
        for target, event in self._waiters:
            if target <= self.t + 1e-12:
                due.append(event)
            else:
                remaining.append((target, event))
        self._waiters = remaining
        for event in due:
            event.set()


def minute_bars(start_ns: int, count: int) -> pd.DataFrame:
    stamps = [start_ns + i * MINUTE_NS for i in range(count)]
    index = pd.to_datetime(stamps, utc=True, unit="ns")
    return pd.DataFrame(
        {
            "open": [100.0 + i for i in range(count)],
            "high": [101.0 + i for i in range(count)],
            "low": [99.0 + i for i in range(count)],
            "close": [100.5 + i for i in range(count)],
            "volume": [1.0] * count,
            "trade_count": [2] * count,
        },
        index=index,
    )


def tape_trades(rows: list[tuple[int, int]]) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "trade_id": [str(trade_id) for trade_id, _ in rows],
            "price": ["100"] * len(rows),
            "quantity": ["0.01"] * len(rows),
            "quote_qty": ["1"] * len(rows),
            "buyer_maker": [False] * len(rows),
            "ts_event_ns": [ts for _, ts in rows],
        }
    )


async def pump(n: int = 40) -> None:
    for _ in range(n):
        await asyncio.sleep(0)


async def wait_sleeping(clock: VirtualClock, timeout: float = 1.0) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while not clock._waiters:
        if loop.time() >= deadline:
            raise AssertionError("playback did not wait on the clock")
        await asyncio.sleep(0)


async def run_for(clock: VirtualClock, seconds: float) -> None:
    deadline = clock.t + seconds
    while clock.t < deadline - 1e-12:
        clock.advance(min(0.033, deadline - clock.t))
        await pump()


def collected(frames: list) -> list:
    return [decode_frame(payload) if isinstance(payload, (bytes, bytearray)) else payload for payload in frames]


@pytest.fixture
def clock() -> VirtualClock:
    return VirtualClock()


@pytest.fixture
def frames() -> list[bytes]:
    return []


@pytest.fixture
async def controller(clock: VirtualClock, frames: list[bytes]) -> PlaybackController:
    async def send(payload: bytes) -> None:
        frames.append(payload)

    playback = PlaybackController(None, send, monotonic=clock.monotonic, sleep=clock.sleep)
    bars = minute_bars(START_NS, 5)
    trades = tape_trades(
        [
            (1, START_NS),
            (2, START_NS + 5 * NS),
            (3, START_NS + MINUTE_NS),
            (4, START_NS + MINUTE_NS + 5 * NS),
            (5, START_NS + 2 * MINUTE_NS),
        ]
    )
    playback.load_memory(INSTRUMENT, "1m", bars, trades)
    yield playback
    await playback.stop(emit=False)


def playback_states(frames: list[bytes]):
    return [frame.playback for frame in collected(frames) if frame.WhichOneof("kind") == "playback"]


def trade_batches(frames: list[bytes]):
    return [frame.trades for frame in collected(frames) if frame.WhichOneof("kind") == "trades"]


def bar_batches(frames: list[bytes]):
    return [frame.bars for frame in collected(frames) if frame.WhichOneof("kind") == "bars"]


@pytest.mark.asyncio
async def test_sixty_x_advances_one_minute_per_wall_second(
    controller: PlaybackController, clock: VirtualClock, frames: list[bytes]
) -> None:
    await controller.start(INSTRUMENT, 0, 0, 60.0, "1m")
    await wait_sleeping(clock)
    await run_for(clock, 1.0)
    assert controller.cursor_ns == START_NS + MINUTE_NS
    assert any(bar.ts_event_ns == START_NS + MINUTE_NS for batch in bar_batches(frames) for bar in batch.bars)
    ids = [trade.id for batch in trade_batches(frames) for trade in batch.trades]
    assert 2 in ids
    assert 3 in ids


@pytest.mark.asyncio
async def test_pause_then_play_does_not_snap_to_start(
    controller: PlaybackController, clock: VirtualClock, frames: list[bytes]
) -> None:
    await controller.start(INSTRUMENT, 0, 0, 60.0, "1m")
    await wait_sleeping(clock)
    await run_for(clock, 1.0)
    paused = controller.cursor_ns
    assert paused > START_NS
    await controller.stop()
    frames.clear()
    mode = await controller.start(INSTRUMENT, 0, 0, 60.0, "1m")
    assert mode == "resume"
    await wait_sleeping(clock)
    states = playback_states(frames)
    assert states
    assert states[0].cursor_ns == paused
    assert states[0].cursor_ns != START_NS
    await run_for(clock, 1.0)
    assert controller.cursor_ns > paused
    resumed_ids = [trade.id for batch in trade_batches(frames) for trade in batch.trades]
    assert 1 not in resumed_ids
    assert 4 in resumed_ids or 5 in resumed_ids


@pytest.mark.asyncio
async def test_play_at_end_restarts_from_range_start(
    controller: PlaybackController, clock: VirtualClock, frames: list[bytes]
) -> None:
    await controller.start(INSTRUMENT, 0, 0, 60.0, "1m")
    await wait_sleeping(clock)
    await run_for(clock, 12.0)
    assert controller.playing is False
    assert controller.cursor_ns == controller.end_ns
    frames.clear()
    mode = await controller.start(INSTRUMENT, 0, 0, 60.0, "1m")
    assert mode == "start"
    await wait_sleeping(clock)
    states = playback_states(frames)
    assert states
    assert states[0].cursor_ns == START_NS
    assert any(bar.ts_event_ns == START_NS for batch in bar_batches(frames) for bar in batch.bars)


@pytest.mark.asyncio
async def test_set_speed_rebases_without_jumping_cursor(
    controller: PlaybackController, clock: VirtualClock
) -> None:
    await controller.start(INSTRUMENT, 0, 0, 1.0, "1m")
    await wait_sleeping(clock)
    await run_for(clock, 0.5)
    before = controller.cursor_ns
    controller.set_speed(60.0)
    assert controller.speed == 60.0
    assert controller.cursor_ns >= before
    assert controller.cursor_ns - before < NS


@pytest.mark.asyncio
async def test_task_exception_emits_playback_failed(clock: VirtualClock) -> None:
    frames: list = []

    async def send(payload: bytes) -> None:
        frame = decode_frame(payload)
        frames.append(frame)
        if frame.WhichOneof("kind") == "bars":
            raise RuntimeError("boom")

    playback = PlaybackController(None, send, monotonic=clock.monotonic, sleep=clock.sleep)
    playback.load_memory(INSTRUMENT, "1m", minute_bars(START_NS, 3), tape_trades([(1, START_NS)]))
    await playback.start(INSTRUMENT, 0, 0, 60.0, "1m")
    await pump(80)
    errors = [frame.error for frame in frames if frame.WhichOneof("kind") == "error"]
    assert errors
    assert errors[0].code == "PLAYBACK_FAILED"
    assert "boom" in errors[0].message
    assert playback.playing is False
    await playback.stop(emit=False)


@pytest.mark.asyncio
async def test_trade_window_includes_prints_after_bar_open(
    controller: PlaybackController, clock: VirtualClock, frames: list[bytes]
) -> None:
    await controller.start(INSTRUMENT, 0, 0, 60.0, "1m")
    await wait_sleeping(clock)
    await run_for(clock, 0.1)
    ids = [trade.id for batch in trade_batches(frames) for trade in batch.trades]
    assert 2 in ids


def test_searchsorted_window_returns_last_200_due_prints() -> None:
    start = START_NS
    trade_ts = start + np.arange(20_000, dtype=np.int64) * 1_000_000
    cursor = int(trade_ts[15_000])
    window = trade_window_slice(trade_ts, start, cursor, TAPE_LIMIT)
    assert window.stop - window.start == TAPE_LIMIT
    assert window.stop == 15_001
    assert window.start == 15_001 - TAPE_LIMIT
    assert int(trade_ts[window.stop - 1]) == cursor
