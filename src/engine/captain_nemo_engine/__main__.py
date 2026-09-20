from __future__ import annotations

import asyncio
import os

from captain_nemo_engine.console import log_info, print_banner
from captain_nemo_engine.paths import DEFAULT_CATALOG, DEFAULT_HOST, DEFAULT_PORT, ensure_generated_path
from captain_nemo_engine.server import serve


def main() -> None:
    ensure_generated_path()
    host = os.environ.get("NEMO_HOST", DEFAULT_HOST)
    port = int(os.environ.get("NEMO_PORT", str(DEFAULT_PORT)))
    catalog = os.environ.get("NEMO_CATALOG", str(DEFAULT_CATALOG))
    print_banner(host, port, catalog)
    try:
        asyncio.run(serve(host, port, catalog))
    except KeyboardInterrupt:
        log_info("stopped")


if __name__ == "__main__":
    main()
