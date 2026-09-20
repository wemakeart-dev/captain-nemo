from __future__ import annotations

import asyncio
import io
from pathlib import Path

import pytest
from rich.console import Console

from captain_nemo_engine import __version__
from captain_nemo_engine.__main__ import main
from captain_nemo_engine.console import (
    STYLE_ERROR,
    STYLE_SUCCESS,
    STYLE_WARN,
    format_event,
    log_error,
    log_success,
    log_warn,
    print_banner,
)
from captain_nemo_engine.server import serve


def _capture_console() -> tuple[io.StringIO, Console]:
    buf = io.StringIO()
    out = Console(file=buf, force_terminal=True, width=80, highlight=False, color_system="truecolor")
    return buf, out


def test_format_event_uses_color_markup() -> None:
    success = format_event(STYLE_SUCCESS, "listening")
    warn = format_event(STYLE_WARN, "unknown instrument")
    error = format_event(STYLE_ERROR, "import failed")
    assert STYLE_SUCCESS == "green"
    assert STYLE_WARN == "orange1"
    assert STYLE_ERROR == "red"
    assert "[green]listening[/green]" in success
    assert "[orange1]unknown instrument[/orange1]" in warn
    assert "[red]import failed[/red]" in error


def test_banner_includes_engine_summary() -> None:
    buf, out = _capture_console()
    print_banner("127.0.0.1", 8765, "E:/data/catalog", out=out)
    text = buf.getvalue()
    assert "Captain Nemo" in text
    assert __version__ in text
    assert "ws://127.0.0.1:8765" in text
    assert "E:/data/catalog" in text
    assert "Ctrl+C" in text


def test_event_helpers_write_messages() -> None:
    buf, out = _capture_console()
    log_success("imported BTCUSDC-PERP.BINANCE", out=out)
    log_warn("empty playback range", out=out)
    log_error("path not found", out=out)
    text = buf.getvalue()
    assert "imported BTCUSDC-PERP.BINANCE" in text
    assert "empty playback range" in text
    assert "path not found" in text


def test_main_handles_keyboard_interrupt(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("captain_nemo_engine.__main__.print_banner", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("captain_nemo_engine.__main__.log_info", lambda *_args, **_kwargs: None)

    def boom(coro: object, *_args: object, **_kwargs: object) -> None:
        close = getattr(coro, "close", None)
        if callable(close):
            close()
        raise KeyboardInterrupt

    monkeypatch.setattr("captain_nemo_engine.__main__.asyncio.run", boom)
    main()


@pytest.mark.asyncio
async def test_serve_returns_when_shutdown_set(tmp_path: Path) -> None:
    shutdown = asyncio.Event()
    shutdown.set()
    await asyncio.wait_for(serve("127.0.0.1", 0, tmp_path, shutdown=shutdown), timeout=5)
