from pathlib import Path

from captain_nemo_engine.paths import ensure_generated_path
from captain_nemo_engine.wire import decode_frame, error_frame, hello_frame, new_frame

ensure_generated_path()

from captain_nemo.v1 import wire_pb2 as wire


def _golden_path() -> Path:
    return Path(__file__).resolve().parents[2] / "proto" / "testdata" / "golden_bar_batch.bin"


def build_golden_frame() -> wire.SocketFrame:
    frame = new_frame()
    batch = frame.bars
    batch.instrument_id = "BTCUSDC-PERP.BINANCE"
    batch.bar_step = "1m"
    batch.snapshot = True
    bar = batch.bars.add()
    bar.ts_event_ns = 1785542400000000000
    bar.open = "62806.8"
    bar.high = "62810.0"
    bar.low = "62800.0"
    bar.close = "62808.2"
    bar.volume = "1.5"
    bar.trade_count = 3
    return frame


def test_hello_and_error_round_trip() -> None:
    hello = decode_frame(hello_frame())
    assert hello.WhichOneof("kind") == "hello"
    assert hello.hello.version == "1"
    error = decode_frame(error_frame(7, "INVALID_PATH", "missing.csv"))
    assert error.correlation_id == 7
    assert error.error.code == "INVALID_PATH"


def test_bar_batch_round_trip_matches_golden() -> None:
    frame = build_golden_frame()
    payload = frame.SerializeToString()
    parsed = decode_frame(payload)
    assert parsed.bars.instrument_id == "BTCUSDC-PERP.BINANCE"
    assert parsed.bars.bars[0].open == "62806.8"
    path = _golden_path()
    assert path.exists()
    golden = path.read_bytes()
    assert payload == golden
    from_file = decode_frame(golden)
    assert from_file.bars.bars[0].close == "62808.2"
    assert from_file.bars.bars[0].ts_event_ns == 1785542400000000000
    assert from_file.bars.snapshot is True
