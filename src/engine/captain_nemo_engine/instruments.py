from __future__ import annotations

from decimal import Decimal, ROUND_DOWN

import pandas as pd
from nautilus_trader.model.identifiers import InstrumentId, Symbol, Venue
from nautilus_trader.model.instruments import CryptoPerpetual
from nautilus_trader.model.objects import Currency, Money, Price, Quantity

_QUOTE_SUFFIXES = ("USDT", "USDC", "BUSD", "USD")


def split_symbol(symbol: str) -> tuple[str, str]:
    upper = symbol.upper()
    for quote in _QUOTE_SUFFIXES:
        if upper.endswith(quote) and len(upper) > len(quote):
            return upper[: -len(quote)], quote
    raise ValueError(f"unable to split base/quote from symbol: {symbol}")


def _precision_from_values(values: pd.Series) -> int:
    precision = 0
    for raw in values.astype(str).head(500):
        text = raw.strip()
        if "." not in text:
            continue
        decimals = text.split(".", 1)[1].rstrip("0")
        precision = max(precision, len(decimals))
    return precision


def _increment(precision: int) -> str:
    if precision <= 0:
        return "1"
    return "0." + ("0" * (precision - 1)) + "1"


def perpetual_from_trades(symbol: str, trades: pd.DataFrame) -> CryptoPerpetual:
    base, quote = split_symbol(symbol)
    price_precision = max(_precision_from_values(trades["price"]), 1)
    size_precision = max(_precision_from_values(trades["quantity"]), 3)
    base_ccy = Currency.from_str(base)
    quote_ccy = Currency.from_str(quote)
    price_increment = Price.from_str(_increment(price_precision))
    size_increment = Quantity.from_str(_increment(size_precision))
    min_qty = Quantity.from_str(_increment(size_precision))
    max_qty = Quantity.from_str(str(Decimal("1000000").quantize(Decimal(_increment(size_precision)), rounding=ROUND_DOWN)))
    max_price = Price.from_str("10000000" if price_precision == 0 else f"10000000.{'0' * price_precision}")
    min_price = Price.from_str(_increment(price_precision))
    return CryptoPerpetual(
        instrument_id=InstrumentId(symbol=Symbol(f"{symbol}-PERP"), venue=Venue("BINANCE")),
        raw_symbol=Symbol(symbol),
        base_currency=base_ccy,
        quote_currency=quote_ccy,
        settlement_currency=quote_ccy,
        is_inverse=False,
        price_precision=price_precision,
        size_precision=size_precision,
        price_increment=price_increment,
        size_increment=size_increment,
        max_quantity=max_qty,
        min_quantity=min_qty,
        max_notional=None,
        min_notional=Money(10, quote_ccy),
        max_price=max_price,
        min_price=min_price,
        margin_init=Decimal("0.0500"),
        margin_maint=Decimal("0.0250"),
        maker_fee=Decimal("0.000200"),
        taker_fee=Decimal("0.000400"),
        ts_event=0,
        ts_init=0,
    )
