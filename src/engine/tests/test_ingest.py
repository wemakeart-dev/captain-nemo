from pathlib import Path

from captain_nemo_engine.actor import StrategyStreamSeam
from captain_nemo_engine.ingest import import_csv, load_minute_bars, load_trades
from captain_nemo_engine.paths import ensure_generated_path

ensure_generated_path()

FIXTURE = Path(__file__).parent / "fixtures" / "BTCUSDC-trades-sample.csv"


def test_import_csv_writes_catalog_bars_and_trades(tmp_path: Path) -> None:
    item = import_csv(FIXTURE, tmp_path)
    assert item["instrument_id"] == "BTCUSDC-PERP.BINANCE"
    assert item["trade_count"] == 25
    bars = load_minute_bars(tmp_path, item["instrument_id"])
    trades = load_trades(tmp_path, item["instrument_id"])
    assert not bars.empty
    assert len(trades) == 25
    assert (tmp_path / "nemo-index.json").exists()


def test_strategy_stream_seam_serializes_reserved_events() -> None:
    seam = StrategyStreamSeam()
    fill = seam.fill_event(
        "BTCUSDC-PERP.BINANCE",
        "O-1",
        "T-1",
        "BUY",
        "0.01",
        "62810.0",
        1785542400000000000,
    )
    assert fill.WhichOneof("kind") == "fill"
    assert fill.fill.order_id == "O-1"
    payload = fill.SerializeToString()
    assert payload
