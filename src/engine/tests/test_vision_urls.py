from captain_nemo_engine.vision.agg_trades import spec as agg_spec
from captain_nemo_engine.vision.constants import BASE_URL
from captain_nemo_engine.vision.index_price_klines import spec as index_spec
from captain_nemo_engine.vision.klines import spec as kline_spec
from captain_nemo_engine.vision.mark_price_klines import spec as mark_spec
from captain_nemo_engine.vision.premium_index_klines import spec as premium_spec
from captain_nemo_engine.vision.spec import VisionError, vision_spec
from captain_nemo_engine.vision.trades import spec as trade_spec


def official_path(trading_type: str, market_data_type: str, time_period: str, symbol: str, interval: str | None = None) -> str:
    trading_type_path = "data/spot"
    if trading_type != "spot":
        trading_type_path = f"data/futures/{trading_type}"
    if interval is not None:
        return f"{trading_type_path}/{time_period}/{market_data_type}/{symbol.upper()}/{interval}/"
    return f"{trading_type_path}/{time_period}/{market_data_type}/{symbol.upper()}/"


def test_um_monthly_trades_matches_official_layout() -> None:
    spec = trade_spec("um", "btcusdc", "monthly", "08-2026")
    assert spec.relative_dir == official_path("um", "trades", "monthly", "BTCUSDC")
    assert spec.archive_name == "BTCUSDC-trades-2026-08.zip"
    assert spec.download_url == f"{BASE_URL}data/futures/um/monthly/trades/BTCUSDC/BTCUSDC-trades-2026-08.zip"


def test_um_daily_trades_matches_official_layout() -> None:
    spec = trade_spec("UM", "BTCUSDC", "daily", "01-08-2026")
    assert spec.relative_dir == official_path("um", "trades", "daily", "BTCUSDC")
    assert spec.archive_name == "BTCUSDC-trades-2026-08-01.zip"
    assert spec.download_url == (
        f"{BASE_URL}data/futures/um/daily/trades/BTCUSDC/BTCUSDC-trades-2026-08-01.zip"
    )


def test_spot_monthly_klines_matches_readme_example() -> None:
    spec = kline_spec("spot", "ADABKRW", "monthly", "2020-08", "1h")
    assert spec.relative_dir == official_path("spot", "klines", "monthly", "ADABKRW", "1h")
    assert spec.archive_name == "ADABKRW-1h-2020-08.zip"
    assert spec.download_url == f"{BASE_URL}data/spot/monthly/klines/ADABKRW/1h/ADABKRW-1h-2020-08.zip"


def test_aggtrades_and_futures_klines_match_official_paths() -> None:
    agg = agg_spec("cm", "BTCUSD_PERP", "daily", "2021-01-01")
    assert agg.relative_dir == official_path("cm", "aggTrades", "daily", "BTCUSD_PERP")
    assert agg.archive_name == "BTCUSD_PERP-aggTrades-2021-01-01.zip"

    index = index_spec("um", "BTCUSDT", "monthly", "02-2020", "1w")
    assert index.relative_dir == official_path("um", "indexPriceKlines", "monthly", "BTCUSDT", "1w")
    assert index.archive_name == "BTCUSDT-1w-2020-02.zip"

    mark = mark_spec("um", "ETHUSDT", "monthly", "2020-12", "1w")
    assert mark.relative_dir == official_path("um", "markPriceKlines", "monthly", "ETHUSDT", "1w")

    premium = premium_spec("cm", "BTCUSD_PERP", "daily", "2021-01-01", "1m")
    assert premium.relative_dir == official_path("cm", "premiumIndexKlines", "daily", "BTCUSD_PERP", "1m")
    assert premium.archive_name == "BTCUSD_PERP-1m-2021-01-01.zip"


def test_iso_period_and_display_period_build_the_same_url() -> None:
    display = vision_spec("um", "trades", "monthly", "BTCUSDC", "08-2026")
    iso = vision_spec("um", "trades", "monthly", "BTCUSDC", "2026-08")
    assert display.download_url == iso.download_url


def test_futures_only_datasets_reject_spot() -> None:
    try:
        vision_spec("spot", "indexPriceKlines", "monthly", "BTCUSDT", "08-2026", "1h")
    except VisionError as exc:
        assert exc.code == "IMPORT_FAILED"
    else:
        raise AssertionError("expected VisionError")
