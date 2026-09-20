# Engine

The engine is a uv-managed Python package at `src/engine`. It wraps Nautilus Trader (`nautilus-trader` >=1.221,<2, currently 1.231.0 wheels) for catalog ingest and serves a localhost protobuf WebSocket. Visualization playback uses an asyncio clock, not `BacktestEngine.run()`. Runtime deps include `rich` for the process console.

## Process

```powershell
uv sync --project src/engine
uv run --directory src/engine python -m captain_nemo_engine
```

Ctrl+C (SIGINT) stops the server and closes WebSocket sessions without a `KeyboardInterrupt` traceback. Playback tasks are cancelled as connections drop.

Environment:

| Variable | Default |
| --- | --- |
| `NEMO_HOST` | `127.0.0.1` |
| `NEMO_PORT` | `8765` |
| `NEMO_CATALOG` | `<repo>/data/catalog` |

The socket is local-only. `data/` is gitignored.

## Console

On start the process prints a Rich banner to **stderr** (engine version, `ws://host:port`, catalog path, Nautilus version, Python version, Ctrl+C hint). After that it prints timestamped event lines as they happen:

| Color | When |
| --- | --- |
| Green | Listening, client connected, import/query/playback succeeded |
| Orange | Unknown instrument, empty playback range, bad command |
| Red | Import failure, internal dispatch errors, playback task failures (`PLAYBACK_FAILED`) |
| Dim | Disconnect, list catalog, speed change, playback pause/resume, shutdown |

Logs stay on the session/CLI boundary. The playback clock does **not** log bar deltas or trade-tape frames; Rich `Live` / `Status` / `Progress` are not used.

## Playback

Visualization uses an asyncio clock, not `BacktestEngine.run()`. `PlaybackController` keeps a session: instrument, bar step, range, cursor, and speed.

- **Play** loads 1-minute bars and the slim trade tape once (parquet cache keyed by path mtime), then ticks at about 30 Hz. Each tick always sends `PlaybackState`. Due bars (capped at 256 per tick) and trades in `(prev_cursor, cursor]` (last 200) go out only when they are due.
- **Pause** (`StopPlayback`) freezes `cursor_ns` and sends `PlaybackState { playing: false }`. The task is cancelled; parquet is not re-read.
- **Play again** with `start_ns = 0` (or the paused cursor) **resumes** the same instrument and step when the cursor is still before `end_ns`. It does not snap to the first bar.
- **Play** at the end of the range, or with a different instrument/step, starts from `start_ns` or the first bar.
- **Play** while already playing is a no-op.
- **SetSpeed** rebases the wall clock (`sim0 = cursor`, `wall0 = now`) so the cursor does not jump. The replay multiplier is `cursor = sim0 + (monotonic - wall0) * speed`.
- Trade lookup is `numpy.searchsorted` on a sorted `int64` timestamp vector. Proto encoding walks column arrays, not `iterrows`. Catalog reads run in `asyncio.to_thread`.
- Clock exceptions send `Error { code: PLAYBACK_FAILED }` and a red log line. They do not leave the UI stuck on “Playing”.

## Ingest

Supported files: Binance Vision **futures / um / daily or monthly / trades**.

Examples:

- `BTCUSDC-trades-2026-08.csv`
- `BTCUSDC-trades-2026-08-01.csv`

Columns: `id, price, qty, quote_qty, time, is_buyer_maker`

`time` is Unix milliseconds UTC. The loader parses that column with `unit="ms"`. Stored trades and the wire use `ts_event_ns` as UTC **nanoseconds**. Bar aggregation reconstructs the index with `pd.to_datetime(..., utc=True, unit="ns")`. Do not cast a millisecond-resolution DatetimeIndex with `.astype("int64")`; pandas 3 keeps `datetime64[ms]` and that yields ~1e12 values, which the chart then plots near 1970.

Official extracts may be headerless; the loader accepts both.

Catalogs written before the ns conversion must be **re-imported**. Old `nemo_bars` / `nemo_trades` parquet will show epoch dates on the chart.

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
| `StartPlayback` | Prepare/resume the clock; ack; paced bar deltas, capped trade tape, `PlaybackState` |
| `StopPlayback` | Pause: freeze cursor, `PlaybackState { playing: false }`, ack |
| `SetSpeed` | Rebase the replay multiplier; ack + `PlaybackState` |

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
- Playback clock (virtual time): 60x pacing, pause/resume cursor, restart at end, speed rebase, trade window, `PLAYBACK_FAILED`
- WebSocket play → pause → play keeps the cursor
- Console banner, color markup, Ctrl+C / shutdown event
- Protobuf round-trip vs golden bytes (`src/proto/testdata/golden_bar_batch.bin`)
