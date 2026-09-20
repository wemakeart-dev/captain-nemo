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
