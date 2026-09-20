from __future__ import annotations

import json
import urllib.error
import urllib.request

from captain_nemo_engine.vision.http import DownloadError, Opener
from captain_nemo_engine.vision.spec import canonical_trading_type

EXCHANGE_INFO = {
    "um": "https://fapi.binance.com/fapi/v1/exchangeInfo",
    "cm": "https://dapi.binance.com/dapi/v1/exchangeInfo",
    "spot": "https://api.binance.com/api/v3/exchangeInfo",
}


def list_symbols(trading_type: str, *, opener: Opener | None = None) -> list[str]:
    trading = canonical_trading_type(trading_type)
    url = EXCHANGE_INFO[trading]
    open_url = opener or urllib.request.urlopen
    try:
        response = open_url(url)
        try:
            payload = json.loads(response.read().decode("utf-8"))
        finally:
            close = getattr(response, "close", None)
            if close:
                close()
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, OSError) as exc:
        raise DownloadError(f"failed to list symbols for {trading}") from exc
    symbols = payload.get("symbols") or []
    return [item["symbol"] for item in symbols if item.get("symbol")]
