from datetime import date

from captain_nemo_engine.vision.dates import daily_periods, effective_intervals, iter_days, monthly_periods
from captain_nemo_engine.vision.trades import daily_specs, monthly_specs


def test_monthly_periods_only_emit_requested_months() -> None:
    periods = monthly_periods(["2020"], [2, 12], start="2020-01-01", end="2020-12-31")
    assert periods == ["2020-02", "2020-12"]


def test_monthly_periods_skip_month_before_start_day() -> None:
    periods = monthly_periods(["2020"], [2, 3], start="2020-02-15", end="2020-03-01")
    assert periods == ["2020-03"]


def test_daily_periods_do_not_materialize_unused_history() -> None:
    days = daily_periods(start="2021-01-01", end="2021-01-02")
    assert days == ["2021-01-01", "2021-01-02"]
    assert iter_days(date(2021, 1, 1), date(2021, 1, 2)) == [date(2021, 1, 1), date(2021, 1, 2)]


def test_daily_periods_filter_supplied_dates() -> None:
    days = daily_periods(["2021-01-01", "2021-06-01"], start="2021-01-01", end="2021-02-01")
    assert days == ["2021-01-01"]


def test_trade_range_specs_are_one_file_per_period() -> None:
    monthly = monthly_specs("um", ["BTCUSDC"], ["2026"], months=[8], start="2026-08-01", end="2026-08-01")
    assert [item.archive_name for item in monthly] == ["BTCUSDC-trades-2026-08.zip"]
    daily = daily_specs("um", ["ETHUSDT"], dates=["2026-08-01", "2026-08-02"], start="2026-08-01", end="2026-08-01")
    assert [item.archive_name for item in daily] == ["ETHUSDT-trades-2026-08-01.zip"]


def test_daily_intervals_drop_week_and_month() -> None:
    assert effective_intervals("daily", ["1m", "1w", "1mo", "1h"]) == ["1m", "1h"]
    assert effective_intervals("monthly", ["1m", "1w"]) == ["1m", "1w"]
