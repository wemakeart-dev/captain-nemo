from __future__ import annotations

import sys
from datetime import datetime
from importlib.metadata import PackageNotFoundError, version as pkg_version

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from captain_nemo_engine import __version__

STYLE_SUCCESS = "green"
STYLE_WARN = "orange1"
STYLE_ERROR = "red"
STYLE_INFO = "dim"

console = Console(file=sys.stderr, highlight=False)


def _timestamp() -> str:
    return datetime.now().strftime("%H:%M:%S")


def format_event(style: str, message: str) -> str:
    return f"[dim]{_timestamp()}[/dim] [{style}]{message}[/{style}]"


def _print_event(style: str, message: str, out: Console | None = None) -> None:
    (out or console).print(format_event(style, message))


def log_success(message: str, *, out: Console | None = None) -> None:
    _print_event(STYLE_SUCCESS, message, out)


def log_warn(message: str, *, out: Console | None = None) -> None:
    _print_event(STYLE_WARN, message, out)


def log_error(message: str, *, out: Console | None = None) -> None:
    _print_event(STYLE_ERROR, message, out)


def log_info(message: str, *, out: Console | None = None) -> None:
    _print_event(STYLE_INFO, message, out)


def nautilus_version() -> str:
    try:
        return pkg_version("nautilus-trader")
    except PackageNotFoundError:
        return "unknown"


def print_banner(host: str, port: int, catalog: str, *, out: Console | None = None) -> None:
    table = Table.grid(padding=(0, 2))
    table.add_column(style="dim")
    table.add_column()
    table.add_row("Engine", f"captain-nemo-engine {__version__}")
    table.add_row("WebSocket", f"ws://{host}:{port}")
    table.add_row("Catalog", str(catalog))
    table.add_row("Nautilus", nautilus_version())
    table.add_row("Python", sys.version.split()[0])
    table.add_row("Stop", "Ctrl+C")
    (out or console).print(Panel(table, title="Captain Nemo", border_style="cyan"))
