from __future__ import annotations

import asyncio
import signal
from collections.abc import Callable
from pathlib import Path
from typing import Any

from websockets.asyncio.server import ServerConnection
from websockets.asyncio.server import serve as ws_serve

from captain_nemo_engine.bars import resample_bars
from captain_nemo_engine.console import log_error, log_info, log_success, log_warn
from captain_nemo_engine.ingest import import_csv, load_minute_bars, remove_imported_file
from captain_nemo_engine.library import LibraryError, list_files, list_instruments, move_file
from captain_nemo_engine.paths import DEFAULT_CATALOG, DEFAULT_HOST, DEFAULT_PORT, ensure_generated_path
from captain_nemo_engine.playback import PlaybackController, PlaybackError, bars_to_proto, filter_range
from captain_nemo_engine.wire import decode_frame, error_frame, hello_frame, new_frame

ensure_generated_path()

from captain_nemo.v1 import wire_pb2 as wire

_SHUTDOWN_SIGNALS = (signal.SIGINT, signal.SIGTERM, getattr(signal, "SIGBREAK", None))


def _fill_file_entry(entry: wire.FileEntry, item: dict[str, Any]) -> None:
    entry.file_id = item["file_id"]
    entry.provider = item["provider"]
    entry.dataset = item["dataset"]
    entry.granularity = item["granularity"]
    entry.period = item["period"]
    entry.period_key = item["period_key"]
    entry.file_name = item["file_name"]
    entry.path = item.get("path") or item.get("source_path", "")
    entry.instrument_id = item["instrument_id"]
    entry.symbol = item.get("symbol", "")
    entry.start_ns = int(item.get("start_ns", 0))
    entry.end_ns = int(item.get("end_ns", 0))
    entry.trade_count = int(item.get("trade_count", 0))


def _playback_ack(cid: int, playing: bool, speed: float) -> bytes:
    result = new_frame(cid)
    result.result.playback.playing = playing
    result.result.playback.speed = speed
    return result.SerializeToString()


def _peer(connection: ServerConnection) -> str:
    remote = getattr(connection, "remote_address", None)
    if remote is None:
        return "client"
    if isinstance(remote, tuple) and len(remote) >= 2:
        return f"{remote[0]}:{remote[1]}"
    return str(remote)


def _bound_endpoint(server: object, host: str, port: int) -> str:
    sockets = getattr(server, "sockets", None) or ()
    if sockets:
        sockname = sockets[0].getsockname()
        return f"{sockname[0]}:{sockname[1]}"
    return f"{host}:{port}"


def install_shutdown(loop: asyncio.AbstractEventLoop, shutdown: asyncio.Event) -> Callable[[], None]:
    def request_stop(*_args: object) -> None:
        loop.call_soon_threadsafe(shutdown.set)

    names = [sig for sig in _SHUTDOWN_SIGNALS if sig is not None]
    try:
        for sig in names:
            loop.add_signal_handler(sig, request_stop)

        def restore() -> None:
            for sig in names:
                loop.remove_signal_handler(sig)

        return restore
    except NotImplementedError:
        previous: dict[int, Any] = {}
        for sig in names:
            try:
                previous[sig] = signal.getsignal(sig)
                signal.signal(sig, request_stop)
            except (OSError, RuntimeError, ValueError):
                previous.pop(sig, None)

        def restore() -> None:
            for sig, handler in previous.items():
                signal.signal(sig, handler)

        return restore


class EngineSession:
    def __init__(self, catalog_root: Path, connection: ServerConnection) -> None:
        self.catalog_root = catalog_root
        self.connection = connection
        self.playback = PlaybackController(catalog_root, self.send)

    async def send(self, payload: bytes) -> None:
        await self.connection.send(payload)

    async def handle(self) -> None:
        peer = _peer(self.connection)
        log_success(f"client connected {peer}")
        await self.send(hello_frame())
        try:
            async for message in self.connection:
                payload = message.encode("utf-8") if isinstance(message, str) else message
                try:
                    frame = decode_frame(payload)
                    await self._dispatch(frame)
                except Exception as exc:
                    log_error(f"internal error: {exc}")
                    await self.send(error_frame(0, "INTERNAL", str(exc)))
        finally:
            await self.playback.stop(emit=False)
            log_info(f"client disconnected {peer}")

    async def _dispatch(self, frame: wire.SocketFrame) -> None:
        cid = frame.correlation_id
        kind = frame.WhichOneof("kind")
        if kind != "command":
            log_warn("expected command frame")
            await self.send(error_frame(cid, "BAD_COMMAND", "expected command frame"))
            return
        command = frame.command
        body = command.WhichOneof("body")
        if body == "import_csv":
            await self._import_csv(cid, command.import_csv)
        elif body == "list_catalog":
            await self._list_catalog(cid)
        elif body == "list_files":
            await self._list_files(cid)
        elif body == "remove_file":
            await self._remove_file(cid, command.remove_file)
        elif body == "move_file":
            await self._move_file(cid, command.move_file)
        elif body == "query_bars":
            await self._query_bars(cid, command.query_bars)
        elif body == "start_playback":
            await self._start_playback(cid, command.start_playback)
        elif body == "stop_playback":
            await self.playback.stop()
            log_info("playback paused")
            await self.send(_playback_ack(cid, False, self.playback.speed))
        elif body == "reset_playback":
            await self.playback.reset()
            log_info("playback reset")
            await self.send(_playback_ack(cid, False, self.playback.speed))
        elif body == "set_speed":
            speed = command.set_speed.speed
            self.playback.set_speed(speed)
            log_info(f"speed set to {self.playback.speed:g}x")
            await self.send(_playback_ack(cid, self.playback.playing, self.playback.speed))
            if self.playback.instrument_id:
                await self.send(self.playback.state_frame())
        else:
            log_warn("unknown command")
            await self.send(error_frame(cid, "BAD_COMMAND", "unknown command"))

    async def _import_csv(self, cid: int, payload: wire.ImportCsv) -> None:
        log_info(f"import started {payload.path}")
        try:
            item = await asyncio.to_thread(
                import_csv,
                Path(payload.path),
                self.catalog_root,
                payload.instrument_id,
                provider=payload.provider,
                dataset=payload.dataset,
                granularity=payload.granularity,
                period=payload.period,
            )
        except FileNotFoundError:
            log_error(f"import failed: path not found {payload.path}")
            await self.send(error_frame(cid, "INVALID_PATH", payload.path))
            return
        except LibraryError as exc:
            log_error(f"import failed: {exc.message}")
            await self.send(error_frame(cid, exc.code, exc.message))
            return
        except Exception as exc:
            log_error(f"import failed: {exc}")
            await self.send(error_frame(cid, "IMPORT_FAILED", str(exc)))
            return
        log_success(f"imported {item['instrument_id']} ({item['trade_count']} trades)")
        result = new_frame(cid)
        body = result.result.import_csv
        body.instrument_id = item["instrument_id"]
        body.trade_count = int(item["trade_count"])
        body.start_ns = int(item["start_ns"])
        body.end_ns = int(item["end_ns"])
        body.file_id = item["file_id"]
        await self.send(result.SerializeToString())

    async def _list_catalog(self, cid: int) -> None:
        items = await asyncio.to_thread(list_instruments, self.catalog_root)
        log_info(f"list catalog ({len(items)} instruments)")
        result = new_frame(cid)
        listing = result.result.list_catalog
        for item in items:
            entry = listing.items.add()
            entry.instrument_id = item["instrument_id"]
            entry.symbol = item.get("symbol", "")
            entry.start_ns = int(item.get("start_ns", 0))
            entry.end_ns = int(item.get("end_ns", 0))
            entry.trade_count = int(item.get("trade_count", 0))
        await self.send(result.SerializeToString())

    async def _list_files(self, cid: int) -> None:
        items = await asyncio.to_thread(list_files, self.catalog_root)
        log_info(f"list files ({len(items)} files)")
        result = new_frame(cid)
        listing = result.result.list_files
        for item in items:
            _fill_file_entry(listing.items.add(), item)
        await self.send(result.SerializeToString())

    async def _remove_file(self, cid: int, payload: wire.RemoveFile) -> None:
        try:
            await asyncio.to_thread(remove_imported_file, self.catalog_root, payload.file_id)
        except LibraryError as exc:
            log_warn(f"remove file failed: {exc.message}")
            await self.send(error_frame(cid, exc.code, exc.message))
            return
        except Exception as exc:
            log_error(f"remove file failed: {exc}")
            await self.send(error_frame(cid, "IMPORT_FAILED", str(exc)))
            return
        log_success(f"removed file {payload.file_id}")
        result = new_frame(cid)
        result.result.remove_file.file_id = payload.file_id
        await self.send(result.SerializeToString())

    async def _move_file(self, cid: int, payload: wire.MoveFile) -> None:
        try:
            item = await asyncio.to_thread(
                move_file,
                self.catalog_root,
                payload.file_id,
                payload.provider,
                payload.dataset,
                payload.granularity,
                payload.period,
            )
        except LibraryError as exc:
            log_warn(f"move file failed: {exc.message}")
            await self.send(error_frame(cid, exc.code, exc.message))
            return
        except Exception as exc:
            log_error(f"move file failed: {exc}")
            await self.send(error_frame(cid, "IMPORT_FAILED", str(exc)))
            return
        log_info(f"moved file {payload.file_id}")
        result = new_frame(cid)
        _fill_file_entry(result.result.move_file.file, item)
        await self.send(result.SerializeToString())

    async def _query_bars(self, cid: int, payload: wire.QueryBars) -> None:
        step = payload.bar_step or "1m"
        minute = load_minute_bars(self.catalog_root, payload.instrument_id)
        if minute.empty:
            log_warn(f"unknown instrument {payload.instrument_id}")
            await self.send(error_frame(cid, "UNKNOWN_INSTRUMENT", payload.instrument_id))
            return
        bars = resample_bars(filter_range(minute, payload.start_ns, payload.end_ns), step)
        log_success(f"query bars {payload.instrument_id} {step} ({len(bars)} bars)")
        result = new_frame(cid)
        result.result.query_bars.bar_count = len(bars)
        await self.send(result.SerializeToString())
        if not bars.empty:
            await self.send(bars_to_proto(payload.instrument_id, step, bars, True))

    async def _start_playback(self, cid: int, payload: wire.StartPlayback) -> None:
        step = payload.bar_step or "1m"
        speed = payload.speed or 1.0
        try:
            mode = await self.playback.prepare(
                payload.instrument_id,
                payload.start_ns,
                payload.end_ns,
                speed,
                step,
            )
        except PlaybackError as exc:
            if exc.message == "no bars in range":
                log_warn(f"empty playback range {payload.instrument_id}")
            else:
                log_warn(f"unknown instrument {payload.instrument_id}")
            await self.send(error_frame(cid, exc.code, exc.message))
            return
        result = new_frame(cid)
        result.result.playback.playing = True
        result.result.playback.speed = self.playback.speed
        await self.send(result.SerializeToString())
        if mode != "noop":
            self.playback.launch()
            if mode == "resume":
                log_info(f"playback resumed {payload.instrument_id} {step} {self.playback.speed:g}x")
            else:
                log_success(f"playback started {payload.instrument_id} {step} {self.playback.speed:g}x")


async def serve(
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
    catalog: str | Path = DEFAULT_CATALOG,
    shutdown: asyncio.Event | None = None,
) -> None:
    catalog_root = Path(catalog)
    catalog_root.mkdir(parents=True, exist_ok=True)
    stop = shutdown or asyncio.Event()
    restore = install_shutdown(asyncio.get_running_loop(), stop)

    async def handler(connection: ServerConnection) -> None:
        session = EngineSession(catalog_root, connection)
        await session.handle()

    try:
        async with ws_serve(handler, host, port, max_size=2**23) as server:
            log_success(f"listening on ws://{_bound_endpoint(server, host, port)}")
            try:
                await stop.wait()
            except asyncio.CancelledError:
                stop.set()
                raise
            log_info("stopped")
    finally:
        restore()
