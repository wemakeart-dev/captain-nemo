from pathlib import Path

import pytest

from captain_nemo_engine.library import (
    LibraryError,
    delete_file,
    infer_period_from_name,
    list_files,
    list_instruments,
    move_file,
    normalize_period,
    upsert_file,
)


def sample_item(**overrides: object) -> dict:
    item: dict = {
        "provider": "Binance",
        "dataset": "trades",
        "granularity": "daily",
        "period": "01-08-2026",
        "period_key": "2026-08-01",
        "file_name": "BTCUSDC-trades-2026-08-01.csv",
        "source_path": "E:/data/BTCUSDC-trades-2026-08-01.csv",
        "instrument_id": "BTCUSDC-PERP.BINANCE",
        "symbol": "BTCUSDC",
        "start_ns": 1_785_542_400_000_000_000,
        "end_ns": 1_785_543_600_000_000_000,
        "trade_count": 25,
    }
    item.update(overrides)
    return item


def test_period_display_and_key_round_trip() -> None:
    assert normalize_period("daily", "01-08-2026") == ("01-08-2026", "2026-08-01")
    assert normalize_period("daily", "2026-08-01") == ("01-08-2026", "2026-08-01")
    assert normalize_period("monthly", "08-2026") == ("08-2026", "2026-08")
    assert normalize_period("monthly", "2026-08") == ("08-2026", "2026-08")
    assert infer_period_from_name("BTCUSDC-trades-2026-08.csv") == ("monthly", "08-2026")
    assert infer_period_from_name("BTCUSDC-trades-2026-08-01.csv") == ("daily", "01-08-2026")


def test_upsert_unique_path_and_tree_slot(tmp_path: Path) -> None:
    first = upsert_file(tmp_path, sample_item())
    again = upsert_file(tmp_path, sample_item(trade_count=40, file_id=first["file_id"]))
    assert again["file_id"] == first["file_id"]
    assert again["trade_count"] == 40
    with pytest.raises(LibraryError, match="already occupies"):
        upsert_file(
            tmp_path,
            sample_item(
                source_path="E:/data/other/BTCUSDC-trades-2026-08-01.csv",
                trade_count=3,
            ),
        )


def test_list_instruments_rolls_up_files(tmp_path: Path) -> None:
    upsert_file(tmp_path, sample_item())
    upsert_file(
        tmp_path,
        sample_item(
            file_name="BTCUSDC-trades-2026-08-02.csv",
            source_path="E:/data/BTCUSDC-trades-2026-08-02.csv",
            period="02-08-2026",
            period_key="2026-08-02",
            start_ns=1_785_628_800_000_000_000,
            end_ns=1_785_715_200_000_000_000,
            trade_count=10,
        ),
    )
    items = list_instruments(tmp_path)
    assert len(items) == 1
    assert items[0]["instrument_id"] == "BTCUSDC-PERP.BINANCE"
    assert items[0]["start_ns"] == 1_785_542_400_000_000_000
    assert items[0]["end_ns"] == 1_785_715_200_000_000_000
    assert items[0]["trade_count"] == 35
    files = list_files(tmp_path)
    assert [item["period_key"] for item in files] == ["2026-08-01", "2026-08-02"]


def test_move_updates_taxonomy_only(tmp_path: Path) -> None:
    stored = upsert_file(tmp_path, sample_item())
    moved = move_file(tmp_path, stored["file_id"], "Binance", "trades", "monthly", "08-2026")
    assert moved["granularity"] == "monthly"
    assert moved["period"] == "08-2026"
    assert moved["period_key"] == "2026-08"
    assert moved["source_path"] == stored["source_path"]
    assert moved["start_ns"] == stored["start_ns"]


def test_delete_unknown_file(tmp_path: Path) -> None:
    with pytest.raises(LibraryError) as exc:
        delete_file(tmp_path, "missing")
    assert exc.value.code == "UNKNOWN_FILE"
