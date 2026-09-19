from pathlib import Path

from captain_nemo_engine.csv_loader import has_header, instrument_id_from_symbol, read_trades_csv, symbol_from_path

FIXTURE = Path(__file__).parent / "fixtures" / "BTCUSDC-trades-sample.csv"


def test_headered_sample_parses_trade_columns() -> None:
    assert has_header(FIXTURE)
    frame = read_trades_csv(FIXTURE)
    assert len(frame) == 25
    assert list(frame.columns) == ["trade_id", "price", "quantity", "quote_qty", "buyer_maker"]
    assert str(frame.iloc[0]["price"]) == "62806.8"
    assert bool(frame.iloc[0]["buyer_maker"]) is True
    assert bool(frame.iloc[1]["buyer_maker"]) is False


def test_headerless_sample_parses_the_same_rows(tmp_path: Path) -> None:
    raw = FIXTURE.read_text(encoding="utf-8")
    lines = raw.splitlines()
    headerless = tmp_path / "BTCUSDC-trades-2026-08-01.csv"
    headerless.write_text("\n".join(lines[1:]) + "\n", encoding="utf-8")
    assert has_header(headerless) is False
    headered = read_trades_csv(FIXTURE)
    parsed = read_trades_csv(headerless)
    assert len(parsed) == len(headered)
    assert parsed.iloc[0]["trade_id"] == headered.iloc[0]["trade_id"]
    assert parsed.iloc[-1]["price"] == headered.iloc[-1]["price"]


def test_symbol_and_instrument_id_from_filename() -> None:
    assert symbol_from_path(Path("BTCUSDC-trades-2026-08.csv")) == "BTCUSDC"
    assert instrument_id_from_symbol("BTCUSDC") == "BTCUSDC-PERP.BINANCE"
