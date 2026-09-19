from __future__ import annotations

import asyncio
from pathlib import Path

from websockets.asyncio.server import ServerConnection
from websockets.asyncio.server import serve as ws_serve

from captain_nemo_engine.bars import resample_bars
from captain_nemo_engine.catalog_index import load_index
from captain_nemo_engine.ingest import import_csv, load_minute_bars
from captain_nemo_engine.paths import DEFAULT_CATALOG, DEFAULT_HOST, DEFAULT_PORT, ensure_generated_path
from captain_nemo_engine.playback import PlaybackController, bars_to_proto, filter_range, playback_state_frame
from captain_nemo_engine.wire import decode_frame, error_frame, hello_frame, new_frame

ensure_generated_path()

from captain_nemo.v1 import wire_pb2 as wire


class EngineSession:
    def __init__(self, catalog_root: Path, connection: ServerConnection) -> None:
        self.catalog_root = catalog_root
        self.connection = connection
        self.playback = PlaybackController(catalog_root, self.send)

    async def send(self, payload: bytes) -> None:
        await self.connection.send(payload)

    async def handle(self) -> None:
        await self.send(hello_frame())
        try:
            async for message in self.connection:
                payload = message.encode("utf-8") if isinstance(message, str) else message
                try:
                    frame = decode_frame(payload)
                    await self._dispatch(frame)
                except Exception as exc:
                    await self.send(error_frame(0, "INTERNAL", str(exc)))
        finally:
            await self.playback.stop()

    async def _dispatch(self, frame: wire.SocketFrame) -> None:
        cid = frame.correlation_id
        kind = frame.WhichOneof("kind")
        if kind != "command":
            await self.send(error_frame(cid, "BAD_COMMAND", "expected command frame"))
            return
        command = frame.command
        body = command.WhichOneof("body")
        if body == "import_csv":
            await self._import_csv(cid, command.import_csv)
        elif body == "list_catalog":
            await self._list_catalog(cid)
        elif body == "query_bars":
            await self._query_bars(cid, command.query_bars)
        elif body == "start_playback":
            await self._start_playback(cid, command.start_playback)
        elif body == "stop_playback":
            await self.playback.stop()
            result = new_frame(cid)
            result.result.playback.playing = False
            result.result.playback.speed = self.playback.speed
            await self.send(result.SerializeToString())
        elif body == "set_speed":
            speed = command.set_speed.speed
            self.playback.speed = speed if speed > 0 else 1.0
            result = new_frame(cid)
            result.result.playback.playing = self.playback.playing
            result.result.playback.speed = self.playback.speed
            await self.send(result.SerializeToString())
        else:
            await self.send(error_frame(cid, "BAD_COMMAND", "unknown command"))

    async def _import_csv(self, cid: int, payload: wire.ImportCsv) -> None:
        try:
            item = import_csv(Path(payload.path), self.catalog_root, payload.instrument_id)
        except FileNotFoundError:
            await self.send(error_frame(cid, "INVALID_PATH", payload.path))
            return
        except Exception as exc:
            await self.send(error_frame(cid, "IMPORT_FAILED", str(exc)))
            return
        result = new_frame(cid)
        body = result.result.import_csv
        body.instrument_id = item["instrument_id"]
        body.trade_count = int(item["trade_count"])
        body.start_ns = int(item["start_ns"])
        body.end_ns = int(item["end_ns"])
        await self.send(result.SerializeToString())

    async def _list_catalog(self, cid: int) -> None:
        payload = load_index(self.catalog_root)
        result = new_frame(cid)
        listing = result.result.list_catalog
        for item in payload.get("instruments", []):
            entry = listing.items.add()
            entry.instrument_id = item["instrument_id"]
            entry.symbol = item.get("symbol", "")
            entry.start_ns = int(item.get("start_ns", 0))
            entry.end_ns = int(item.get("end_ns", 0))
            entry.trade_count = int(item.get("trade_count", 0))
        await self.send(result.SerializeToString())

    async def _query_bars(self, cid: int, payload: wire.QueryBars) -> None:
        step = payload.bar_step or "1m"
        minute = load_minute_bars(self.catalog_root, payload.instrument_id)
        if minute.empty:
            await self.send(error_frame(cid, "UNKNOWN_INSTRUMENT", payload.instrument_id))
            return
        bars = resample_bars(filter_range(minute, payload.start_ns, payload.end_ns), step)
        result = new_frame(cid)
        result.result.query_bars.bar_count = len(bars)
        await self.send(result.SerializeToString())
        if not bars.empty:
            await self.send(bars_to_proto(payload.instrument_id, step, bars, True))

    async def _start_playback(self, cid: int, payload: wire.StartPlayback) -> None:
        step = payload.bar_step or "1m"
        minute = load_minute_bars(self.catalog_root, payload.instrument_id)
        if minute.empty:
            await self.send(error_frame(cid, "UNKNOWN_INSTRUMENT", payload.instrument_id))
            return
        bars = resample_bars(filter_range(minute, payload.start_ns, payload.end_ns), step)
        if bars.empty:
            await self.send(error_frame(cid, "UNKNOWN_INSTRUMENT", "no bars in range"))
            return
        start_value = int(bars.index[0].value)
        end_value = int(bars.index[-1].value)
        speed = payload.speed or 1.0
        result = new_frame(cid)
        result.result.playback.playing = True
        result.result.playback.speed = speed
        await self.send(result.SerializeToString())
        await self.send(
            playback_state_frame(
                payload.instrument_id,
                start_value,
                speed,
                True,
                start_value,
                end_value,
            )
        )
        await self.playback.start(
            payload.instrument_id,
            payload.start_ns,
            payload.end_ns,
            speed,
            step,
        )


async def serve(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT, catalog: str | Path = DEFAULT_CATALOG) -> None:
    catalog_root = Path(catalog)
    catalog_root.mkdir(parents=True, exist_ok=True)

    async def handler(connection: ServerConnection) -> None:
        session = EngineSession(catalog_root, connection)
        await session.handle()

    async with ws_serve(handler, host, port, max_size=2**23):
        await asyncio.Future()
