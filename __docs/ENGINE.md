# Engine

The engine is a uv-managed Python package at `src/engine`. It wraps Nautilus Trader (`nautilus-trader` >=1.221,<2, currently 1.231.0 wheels) for catalog ingest and serves a localhost protobuf WebSocket. Visualization playback uses an asyncio clock, not `BacktestEngine.run()`.

## Process

```powershell
uv sync --project src/engine
uv run --directory src/engine python -m captain_nemo_engine
```

Environment:

| Variable | Default |
| --- | --- |
| `NEMO_HOST` | `127.0.0.1` |
| `NEMO_PORT` | `8765` |
| `NEMO_CATALOG` | `<repo>/data/catalog` |

The socket is local-only. `data/` is gitignored.

## Ingest

Supported files: Binance Vision **futures / um / daily or monthly / trades**.

Examples:

- `BTCUSDC-trades-2026-08.csv`
- `BTCUSDC-trades-2026-08-01.csv`

Columns: `id, price, qty, quote_qty, time, is_buyer_maker`

`time` is Unix milliseconds UTC. Official extracts may be headerless; the loader accepts both.

Flow:

1. Chunked pandas read (`csv_loader.py`)
2. `CryptoPerpetual` for `{SYMBOL}-PERP.BINANCE`
3. `TradeTickDataWrangler.process` → one `ParquetDataCatalog.write_data` per import (ticks after the last catalog timestamp only, so consecutive daily files stay disjoint)
4. Merge 1-minute OHLCV parquet for the UI (`nemo_bars/`)
5. Merge slim trades parquet for the playback tape (`nemo_trades/`), keyed by `trade_id`
6. Update `nemo-index.json` for `ListCatalog` with the combined range and count

## Serve

Each WebSocket connection gets `SessionHello`, then `SocketFrame` commands:

| Command | Effect |
| --- | --- |
| `ImportCsv` | Ingest path on disk |
| `ListCatalog` | Index items |
| `QueryBars` | Ack + snapshot `BarBatch` (1m resampled to the requested step) |
| `StartPlayback` | Paced bar deltas, capped trade tape, `PlaybackState` |
| `StopPlayback` | Cancel the playback task |
| `SetSpeed` | Change the asyncio replay multiplier |

Prices and sizes on the wire are decimal strings. Timestamps are `int64` nanoseconds.

## Strategy seam

`actor.py` (`StrategyStreamSeam`) serializes reserved `OrderEvent`, `FillEvent`, and `PositionSnapshot` messages. v1 UI does not render them. A later `BacktestNode` run can publish the same envelope without changing the proto package.

## Generated code

`yarn proto:generate` writes Python modules to `src/generated/python`. The engine prepends that directory to `sys.path`.

## Tests

`yarn test:engine` (uv + pytest):

- Headered and headerless CSV
- Bar aggregation
- Catalog ingest (Nautilus wrangler + parquet)
- WebSocket hello / import / query
- Protobuf round-trip vs golden bytes (`src/proto/testdata/golden_bar_batch.bin`)
