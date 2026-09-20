import asyncio
from pathlib import Path

import pytest
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve as ws_serve

from captain_nemo_engine.paths import ensure_generated_path
from captain_nemo_engine.server import EngineSession
from captain_nemo_engine.wire import decode_frame, new_frame

ensure_generated_path()

from captain_nemo.v1 import wire_pb2 as wire

FIXTURE = Path(__file__).parent / "fixtures" / "BTCUSDC-trades-sample.csv"


@pytest.mark.asyncio
async def test_session_hello_import_and_query(tmp_path: Path) -> None:
    async def handler(connection):
        session = EngineSession(tmp_path, connection)
        await session.handle()

    async with ws_serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        async with connect(f"ws://127.0.0.1:{port}") as client:
            hello = decode_frame(await client.recv())
            assert hello.WhichOneof("kind") == "hello"

            command = new_frame(1)
            command.command.import_csv.path = str(FIXTURE)
            await client.send(command.SerializeToString())
            imported = decode_frame(await client.recv())
            assert imported.WhichOneof("kind") == "result"
            assert imported.result.import_csv.trade_count == 25
            assert imported.result.import_csv.start_ns == 1_785_542_400_000_000_000
            assert imported.result.import_csv.file_id

            listing = new_frame(2)
            listing.command.list_catalog.SetInParent()
            await client.send(listing.SerializeToString())
            listed = decode_frame(await client.recv())
            assert listed.result.list_catalog.items[0].instrument_id == "BTCUSDC-PERP.BINANCE"

            query = new_frame(3)
            query.command.query_bars.instrument_id = "BTCUSDC-PERP.BINANCE"
            query.command.query_bars.bar_step = "1m"
            await client.send(query.SerializeToString())
            ack = decode_frame(await client.recv())
            assert ack.result.query_bars.bar_count > 0
            bars = decode_frame(await client.recv())
            assert bars.WhichOneof("kind") == "bars"
            assert bars.bars.snapshot is True
            assert len(bars.bars.bars) == ack.result.query_bars.bar_count
            assert bars.bars.bars[0].ts_event_ns == 1_785_542_400_000_000_000

            play = new_frame(4)
            play.command.start_playback.instrument_id = "BTCUSDC-PERP.BINANCE"
            play.command.start_playback.bar_step = "1m"
            play.command.start_playback.speed = 60.0
            await client.send(play.SerializeToString())
            started = decode_frame(await client.recv())
            assert started.result.playback.playing is True
            state = decode_frame(await client.recv())
            assert state.WhichOneof("kind") == "playback"
            assert state.playback.playing is True


RANGE_START_NS = 1_785_542_400_000_000_000


async def drain_frames(client, duration: float) -> list:
    frames = []
    loop = asyncio.get_running_loop()
    deadline = loop.time() + duration
    while True:
        remaining = deadline - loop.time()
        if remaining <= 0:
            break
        try:
            raw = await asyncio.wait_for(client.recv(), timeout=remaining)
        except TimeoutError:
            break
        frames.append(decode_frame(raw))
    return frames


async def import_sample(client) -> None:
    hello = decode_frame(await client.recv())
    assert hello.WhichOneof("kind") == "hello"
    command = new_frame(1)
    command.command.import_csv.path = str(FIXTURE)
    await client.send(command.SerializeToString())
    imported = decode_frame(await client.recv())
    assert imported.result.import_csv.trade_count == 25


@pytest.mark.asyncio
async def test_playback_pause_then_play_keeps_cursor(tmp_path: Path) -> None:
    async def handler(connection):
        session = EngineSession(tmp_path, connection)
        await session.handle()

    async with ws_serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        async with connect(f"ws://127.0.0.1:{port}") as client:
            await import_sample(client)

            play = new_frame(2)
            play.command.start_playback.instrument_id = "BTCUSDC-PERP.BINANCE"
            play.command.start_playback.bar_step = "1m"
            play.command.start_playback.speed = 60.0
            await client.send(play.SerializeToString())
            started = decode_frame(await client.recv())
            assert started.result.playback.playing is True
            first = decode_frame(await client.recv())
            assert first.WhichOneof("kind") == "playback"
            assert first.playback.cursor_ns == RANGE_START_NS

            live = await drain_frames(client, 0.25)
            cursors = [frame.playback.cursor_ns for frame in live if frame.WhichOneof("kind") == "playback"]
            assert cursors
            paused_at = cursors[-1]
            assert paused_at > RANGE_START_NS

            stop = new_frame(3)
            stop.command.stop_playback.SetInParent()
            await client.send(stop.SerializeToString())
            after_stop = await drain_frames(client, 0.2)
            kinds = [frame.WhichOneof("kind") for frame in after_stop]
            assert "result" in kinds
            pause_states = [frame.playback for frame in after_stop if frame.WhichOneof("kind") == "playback"]
            assert pause_states
            assert pause_states[-1].playing is False
            assert pause_states[-1].cursor_ns >= paused_at
            held = pause_states[-1].cursor_ns

            play_again = new_frame(4)
            play_again.command.start_playback.instrument_id = "BTCUSDC-PERP.BINANCE"
            play_again.command.start_playback.bar_step = "1m"
            play_again.command.start_playback.speed = 60.0
            await client.send(play_again.SerializeToString())
            resumed_ack = decode_frame(await client.recv())
            assert resumed_ack.result.playback.playing is True
            resumed = await drain_frames(client, 0.25)
            resume_states = [frame.playback for frame in resumed if frame.WhichOneof("kind") == "playback"]
            assert resume_states
            assert resume_states[0].cursor_ns >= held
            assert resume_states[0].cursor_ns != RANGE_START_NS
            later = resume_states[-1].cursor_ns
            assert later >= resume_states[0].cursor_ns
            assert any(frame.WhichOneof("kind") in {"bars", "trades"} for frame in resumed) or later > held


@pytest.mark.asyncio
async def test_library_list_remove_move_and_rejected_dataset(tmp_path: Path) -> None:
    async def handler(connection):
        session = EngineSession(tmp_path, connection)
        await session.handle()

    async with ws_serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        async with connect(f"ws://127.0.0.1:{port}") as client:
            hello = decode_frame(await client.recv())
            assert hello.WhichOneof("kind") == "hello"

            bad = new_frame(1)
            bad.command.import_csv.path = str(FIXTURE)
            bad.command.import_csv.provider = "Binance"
            bad.command.import_csv.dataset = "klines"
            bad.command.import_csv.granularity = "monthly"
            bad.command.import_csv.period = "08-2026"
            await client.send(bad.SerializeToString())
            rejected = decode_frame(await client.recv())
            assert rejected.WhichOneof("kind") == "error"
            assert rejected.error.code == "IMPORT_FAILED"

            command = new_frame(2)
            command.command.import_csv.path = str(FIXTURE)
            command.command.import_csv.provider = "Binance"
            command.command.import_csv.dataset = "trades"
            command.command.import_csv.granularity = "monthly"
            command.command.import_csv.period = "08-2026"
            await client.send(command.SerializeToString())
            imported = decode_frame(await client.recv())
            file_id = imported.result.import_csv.file_id
            assert file_id

            listing = new_frame(3)
            listing.command.list_files.SetInParent()
            await client.send(listing.SerializeToString())
            listed = decode_frame(await client.recv())
            assert listed.result.list_files.items[0].file_id == file_id
            assert listed.result.list_files.items[0].period == "08-2026"

            move = new_frame(4)
            move.command.move_file.file_id = file_id
            move.command.move_file.provider = "Binance"
            move.command.move_file.dataset = "trades"
            move.command.move_file.granularity = "daily"
            move.command.move_file.period = "01-08-2026"
            await client.send(move.SerializeToString())
            moved = decode_frame(await client.recv())
            assert moved.result.move_file.file.period == "01-08-2026"
            assert moved.result.move_file.file.period_key == "2026-08-01"

            remove = new_frame(5)
            remove.command.remove_file.file_id = file_id
            await client.send(remove.SerializeToString())
            removed = decode_frame(await client.recv())
            assert removed.result.remove_file.file_id == file_id

            listing_again = new_frame(6)
            listing_again.command.list_files.SetInParent()
            await client.send(listing_again.SerializeToString())
            empty = decode_frame(await client.recv())
            assert list(empty.result.list_files.items) == []


@pytest.mark.asyncio
async def test_playback_reset_then_play_restarts_at_range_start(tmp_path: Path) -> None:
    async def handler(connection):
        session = EngineSession(tmp_path, connection)
        await session.handle()

    async with ws_serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        async with connect(f"ws://127.0.0.1:{port}") as client:
            await import_sample(client)

            play = new_frame(2)
            play.command.start_playback.instrument_id = "BTCUSDC-PERP.BINANCE"
            play.command.start_playback.bar_step = "1m"
            play.command.start_playback.speed = 60.0
            await client.send(play.SerializeToString())
            started = decode_frame(await client.recv())
            assert started.result.playback.playing is True
            first = decode_frame(await client.recv())
            assert first.WhichOneof("kind") == "playback"
            live = await drain_frames(client, 0.25)
            cursors = [frame.playback.cursor_ns for frame in live if frame.WhichOneof("kind") == "playback"]
            assert cursors
            assert cursors[-1] > RANGE_START_NS

            reset = new_frame(3)
            reset.command.reset_playback.SetInParent()
            await client.send(reset.SerializeToString())
            after_reset = await drain_frames(client, 0.25)
            kinds = [frame.WhichOneof("kind") for frame in after_reset]
            assert "result" in kinds
            reset_states = [frame.playback for frame in after_reset if frame.WhichOneof("kind") == "playback"]
            assert reset_states
            assert reset_states[-1].playing is False
            assert reset_states[-1].cursor_ns == RANGE_START_NS
            assert any(frame.bars.snapshot for frame in after_reset if frame.WhichOneof("kind") == "bars")
            tapes = [frame.trades for frame in after_reset if frame.WhichOneof("kind") == "trades"]
            assert tapes
            assert len(tapes[-1].trades) == 0

            play_again = new_frame(4)
            play_again.command.start_playback.instrument_id = "BTCUSDC-PERP.BINANCE"
            play_again.command.start_playback.bar_step = "1m"
            play_again.command.start_playback.speed = 60.0
            await client.send(play_again.SerializeToString())
            restarted_ack = decode_frame(await client.recv())
            assert restarted_ack.result.playback.playing is True
            restarted = await drain_frames(client, 0.25)
            restart_states = [frame.playback for frame in restarted if frame.WhichOneof("kind") == "playback"]
            assert restart_states
            assert restart_states[0].cursor_ns == RANGE_START_NS
