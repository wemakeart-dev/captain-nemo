import json

from captain_nemo_engine.vision.http import DownloadError
from captain_nemo_engine.vision.symbols import EXCHANGE_INFO, list_symbols
from vision_fakes import FakeOpener


def test_list_symbols_reads_exchange_info() -> None:
    opener = FakeOpener(
        {
            EXCHANGE_INFO["um"]: json.dumps(
                {"symbols": [{"symbol": "BTCUSDC"}, {"symbol": "ETHUSDT"}, {}]}
            ).encode("utf-8")
        }
    )
    assert list_symbols("um", opener=opener) == ["BTCUSDC", "ETHUSDT"]
    assert opener.calls == [EXCHANGE_INFO["um"]]


def test_list_symbols_maps_http_errors() -> None:
    opener = FakeOpener({})
    try:
        list_symbols("spot", opener=opener)
    except DownloadError as exc:
        assert exc.code == "DOWNLOAD_FAILED"
    else:
        raise AssertionError("expected DownloadError")
