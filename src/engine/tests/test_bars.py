from pathlib import Path

from captain_nemo_engine.bars import aggregate_bars, resample_bars
from captain_nemo_engine.csv_loader import read_trades_csv

FIXTURE = Path(__file__).parent / "fixtures" / "BTCUSDC-trades-sample.csv"


def test_minute_bars_cover_the_sample_window() -> None:
    trades = read_trades_csv(FIXTURE)
    bars = aggregate_bars(trades, "1m")
    assert not bars.empty
    assert set(["open", "high", "low", "close", "volume", "trade_count"]).issubset(bars.columns)
    assert int(bars["trade_count"].sum()) == len(trades)


def test_five_minute_resample_reduces_bar_count() -> None:
    trades = read_trades_csv(FIXTURE)
    minute = aggregate_bars(trades, "1m")
    five = resample_bars(minute, "5m")
    assert len(five) <= len(minute)
    assert five.iloc[0]["open"] == minute.iloc[0]["open"]
