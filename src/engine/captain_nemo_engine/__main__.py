from __future__ import annotations

import asyncio
import os

from captain_nemo_engine.paths import DEFAULT_CATALOG, DEFAULT_HOST, DEFAULT_PORT, ensure_generated_path
from captain_nemo_engine.server import serve


def main() -> None:
    ensure_generated_path()
    host = os.environ.get("NEMO_HOST", DEFAULT_HOST)
    port = int(os.environ.get("NEMO_PORT", str(DEFAULT_PORT)))
    catalog = os.environ.get("NEMO_CATALOG", str(DEFAULT_CATALOG))
    asyncio.run(serve(host, port, catalog))


if __name__ == "__main__":
    main()
