from pathlib import Path

import pandas as pd
import pytest

from captain_nemo_engine.actor import StrategyStreamSeam
from captain_nemo_engine.ingest import (
    import_csv,
    import_vision,
    load_minute_bars,
    load_trades,
    remove_imported_file,
    trades_parquet_path,
)
from captain_nemo_engine.library import LibraryError, list_files, move_file
from captain_nemo_engine.paths import ensure_generated_path
from captain_nemo_engine.vision.http import DownloadError
from captain_nemo_engine.vision.trades import spec as trade_spec

from vision_fakes import FakeOpener, FIXTURE, vision_files

ensure_generated_path()


def test_import_csv_writes_catalog_bars_and_trades(tmp_path: Path) -> None:
    item = import_csv(FIXTURE, tmp_path)
    assert item["instrument_id"] == "BTCUSDC-PERP.BINANCE"
    assert item["trade_count"] == 25
    bars = load_minute_bars(tmp_path, item["instrument_id"])
    trades = load_trades(tmp_path, item["instrument_id"])
    assert not bars.empty
    assert len(trades) == 25
    assert item["start_ns"] == 1_785_542_400_000_000_000
    assert int(trades["ts_event_ns"].iloc[0]) == 1_785_542_400_000_000_000
    assert int(pd.Timestamp(bars.index[0]).value) == 1_785_542_400_000_000_000
    assert int(pd.Timestamp(bars.index[0]).year) == 2026
    assert item["file_id"]
    assert (trades["file_id"] == item["file_id"]).all()
    assert (tmp_path / "nemo-library.sqlite").exists()
    assert not (tmp_path / "nemo-index.json").exists()


def test_import_merges_adjacent_files_and_chunked_writes(tmp_path: Path) -> None:
    first = import_csv(FIXTURE, tmp_path, chunksize=5)
    assert first["trade_count"] == 25
    follow = tmp_path / "BTCUSDC-trades-2026-08-01b.csv"
    follow.write_text(
        "\n".join(
            [
                "id,price,qty,quote_qty,time,is_buyer_maker",
                "25,62833.2,0.022,1382.330,1785543600000,true",
                "26,62840.0,0.010,628.400,1785543660000,false",
                "27,62841.5,0.015,942.623,1785543720000,true",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    second = import_csv(follow, tmp_path)
    trades = load_trades(tmp_path, second["instrument_id"])
    assert second["trade_count"] == 27
    assert len(trades) == 27
    assert second["start_ns"] == first["start_ns"]
    assert second["end_ns"] > first["end_ns"]
    bars = load_minute_bars(tmp_path, second["instrument_id"])
    assert not bars.empty
    again = import_csv(FIXTURE, tmp_path, chunksize=8)
    assert again["trade_count"] == 27
    trades = load_trades(tmp_path, second["instrument_id"])
    assert set(trades["file_id"]) == {first["file_id"], second["file_id"]}
    assert first["file_id"] == again["file_id"]


def test_import_metadata_rejects_disabled_dataset(tmp_path: Path) -> None:
    with pytest.raises(LibraryError) as exc:
        import_csv(FIXTURE, tmp_path, dataset="klines", granularity="monthly", period="08-2026")
    assert exc.value.code == "IMPORT_FAILED"


def test_two_daily_files_merge_and_remove_rebuilds(tmp_path: Path) -> None:
    first = import_csv(FIXTURE, tmp_path, provider="Binance", dataset="trades", granularity="daily", period="01-08-2026")
    follow = tmp_path / "BTCUSDC-trades-2026-08-02.csv"
    follow.write_text(
        "\n".join(
            [
                "id,price,qty,quote_qty,time,is_buyer_maker",
                "25,62833.2,0.022,1382.330,1785543600000,true",
                "26,62840.0,0.010,628.400,1785543660000,false",
                "27,62841.5,0.015,942.623,1785543720000,true",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    second = import_csv(follow, tmp_path, provider="Binance", dataset="trades", granularity="daily", period="02-08-2026")
    trades = load_trades(tmp_path, second["instrument_id"])
    assert len(trades) == 27
    assert set(trades["file_id"]) == {first["file_id"], second["file_id"]}
    parquet = trades_parquet_path(tmp_path, second["instrument_id"])
    before = parquet.read_bytes()
    moved = move_file(tmp_path, second["file_id"], "Binance", "trades", "monthly", "08-2026")
    assert moved["period"] == "08-2026"
    assert parquet.read_bytes() == before
    remaining = remove_imported_file(tmp_path, first["file_id"])
    assert remaining["file_id"] == first["file_id"]
    trades = load_trades(tmp_path, second["instrument_id"])
    assert (trades["file_id"] == second["file_id"]).all()
    assert len(trades) == 3
    bars = load_minute_bars(tmp_path, second["instrument_id"])
    assert not bars.empty
    assert [item["file_id"] for item in list_files(tmp_path)] == [second["file_id"]]


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


def _boom(url: str) -> None:
    raise AssertionError(url)


def test_import_vision_writes_library_from_extracted_csv(tmp_path: Path) -> None:
    item = trade_spec("um", "BTCUSDC", "monthly", "08-2026")
    opener = FakeOpener(vision_files(item, "BTCUSDC-trades-2026-08.csv", FIXTURE.read_bytes()))
    imported = import_vision(
        tmp_path,
        symbol="BTCUSDC",
        trading_type="um",
        dataset="trades",
        granularity="monthly",
        period="08-2026",
        download_root=tmp_path / "downloads",
        opener=opener,
    )
    assert imported["instrument_id"] == "BTCUSDC-PERP.BINANCE"
    assert imported["trade_count"] == 25
    assert imported["period"] == "08-2026"
    assert Path(imported["path"]).is_file()
    assert Path(imported["path"]).name == "BTCUSDC-trades-2026-08.csv"
    assert load_trades(tmp_path, imported["instrument_id"]).shape[0] == 25


def test_import_vision_rejects_disabled_datasets_before_http(tmp_path: Path) -> None:
    with pytest.raises(LibraryError) as exc:
        import_vision(
            tmp_path,
            symbol="BTCUSDC",
            trading_type="um",
            dataset="klines",
            granularity="monthly",
            period="08-2026",
            download_root=tmp_path,
            opener=_boom,
        )
    assert exc.value.code == "IMPORT_FAILED"
    with pytest.raises(LibraryError):
        import_vision(
            tmp_path,
            symbol="BTCUSDC",
            trading_type="cm",
            dataset="trades",
            granularity="monthly",
            period="08-2026",
            download_root=tmp_path,
            opener=_boom,
        )
    with pytest.raises(LibraryError):
        import_vision(
            tmp_path,
            symbol="BTCUSDC",
            trading_type="spot",
            dataset="trades",
            granularity="monthly",
            period="08-2026",
            download_root=tmp_path,
            opener=_boom,
        )


def test_import_vision_maps_missing_file_to_download_failed(tmp_path: Path) -> None:
    with pytest.raises(DownloadError) as exc:
        import_vision(
            tmp_path,
            symbol="BTCUSDC",
            trading_type="um",
            dataset="trades",
            granularity="monthly",
            period="08-2026",
            download_root=tmp_path / "downloads",
            opener=FakeOpener({}),
        )
    assert exc.value.code == "DOWNLOAD_FAILED"
