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

Vision downloads extract under `<repo>/data/tmp/binance-vision` (gitignored with `data/`).

The socket is local-only. `data/` is gitignored.

## Console

On start the process prints a Rich banner to **stderr** (engine version, `ws://host:port`, catalog path, Nautilus version, Python version, Ctrl+C hint). After that it prints timestamped event lines as they happen:

| Color | When |
| --- | --- |
| Green | Listening, client connected, import/query/playback succeeded, file removed |
| Orange | Unknown instrument, empty playback range, bad command, unknown file |
| Red | Import failure, internal dispatch errors, playback task failures (`PLAYBACK_FAILED`) |
| Dim | Disconnect, list catalog/files, speed change, playback pause/reset, move, Vision download, shutdown |

Logs stay on the session/CLI boundary. The playback clock does **not** log bar deltas or trade-tape frames; Rich `Live` / `Status` / `Progress` are not used.

## Library

File-manager records live in SQLite at `data/catalog/nemo-library.sqlite` (stdlib `sqlite3`, WAL, short-lived connections inside `asyncio.to_thread`). This is **not** IndexedDB: the catalog of record is already under `NEMO_CATALOG`, and a browser DB would desync on refresh, another browser, or cleared site data.

SQLite is not used for candles or trades. Those stay Parquet (`nemo_bars/`, `nemo_trades/`). Rows are small: path, taxonomy, range, counts.

`files` is unique on `source_path` and on `(provider, dataset, granularity, period, file_name)`. `period` is display (`MM-YYYY` or `DD-MM-YYYY`); `period_key` is ISO (`YYYY-MM` / `YYYY-MM-DD`) for sort.

`ListCatalog` is `GROUP BY instrument_id` over this table. Existing catalogs without library rows stay playable only after re-import (same bar as the ns-conversion note below).

Taxonomy is virtual. CSV files stay on disk; **Move** only updates SQLite columns. **Remove** deletes the SQLite row and that `file_id` from Parquet, rebuilds `nemo_bars` / `nemo_trades`, and rolls up the instrument. It does not delete the user’s CSV or a Vision extract under `data/tmp`.

## Playback

Visualization uses an asyncio clock, not `BacktestEngine.run()`. `PlaybackController` keeps a session: instrument, bar step, range, cursor, and speed.

- **Play** loads 1-minute bars and the slim trade tape once (parquet cache keyed by path mtime), then ticks at about 30 Hz. Each tick always sends `PlaybackState`. Trades in `(prev_cursor, cursor]` (last 200) go out when they are due. Due bar frames (capped at 256 per tick) go out only when this session has **not** already sent a QueryBars snapshot for the same tape. After Select Data, the snapshot is the chart source of truth; Play is cursor + trade tape.
- **QueryBars** reads parquet, resamples, and encodes the snapshot in `asyncio.to_thread`, then warms the playback tape in the background so the next Play is a cache hit + `launch()`.
- **Pause** (`StopPlayback`) freezes `cursor_ns` and sends `PlaybackState { playing: false }`. The task is cancelled; parquet is not re-read.
- **Play again** with `start_ns = 0` (or the paused cursor) **resumes** the same instrument and step when the cursor is still before `end_ns`. It does not snap to the first bar.
- **Stop** (`ResetPlayback`) pauses if playing, rewinds `cursor_ns` to the session start, clears the trade tape, and sends `PlaybackState { playing: false, cursor_ns: start }` plus an empty trade batch. It does **not** re-send bars. Next Play starts from the beginning. Do not overload Pause for this: `StartPlayback` with `start_ns = 0` would otherwise resume mid-range.
- **Play** at the end of the range, or with a different instrument/step, starts from `start_ns` or the first bar.
- **Play** while already playing is a no-op.
- **SetSpeed** rebases the wall clock (`sim0 = cursor`, `wall0 = now`) so the cursor does not jump. The replay multiplier is `cursor = sim0 + (monotonic - wall0) * speed`.
- Trade lookup is `numpy.searchsorted` on a sorted `int64` timestamp vector. Bar timestamps use `DatetimeIndex.as_unit("ns")` (never a raw ms `.astype("int64")`). Proto encoding walks column arrays, not `iterrows`. Catalog reads run in `asyncio.to_thread`.
- Clock exceptions send `Error { code: PLAYBACK_FAILED }` and a red log line. They do not leave the UI stuck on “Playing”.

## Ingest

Supported files: Binance Vision **futures / um / daily or monthly / trades**. Other Futures values are UI-visible and rejected with `IMPORT_FAILED`. The same rule applies to Vision **trading type**: only `um` is ingested in v1. Dataset modules for aggTrades, klines, and futures index/mark/premium klines live in `captain_nemo_engine.vision` for later use.

Examples:

- `BTCUSDC-trades-2026-08.csv`
- `BTCUSDC-trades-2026-08-01.csv`

Columns: `id, price, qty, quote_qty, time, is_buyer_maker`

`time` is Unix milliseconds UTC. The loader parses that column with `unit="ms"`. Stored trades and the wire use `ts_event_ns` as UTC **nanoseconds**. Bar aggregation reconstructs the index with `pd.to_datetime(..., utc=True, unit="ns")`. Do not cast a millisecond-resolution DatetimeIndex with `.astype("int64")`; pandas 3 keeps `datetime64[ms]` and that yields ~1e12 values, which the chart then plots near 1970.

Official extracts may be headerless; the loader accepts both.

Catalogs written before the ns conversion must be **re-imported**. Old `nemo_bars` / `nemo_trades` parquet will show epoch dates on the chart.

Flow (local CSV):

1. Chunked pandas read (`csv_loader.py`)
2. `CryptoPerpetual` for `{SYMBOL}-PERP.BINANCE`
3. `TradeTickDataWrangler.process` → one `ParquetDataCatalog.write_data` per import (ticks after the last catalog timestamp only, so consecutive daily files stay disjoint)
4. Merge 1-minute OHLCV parquet for the UI (`nemo_bars/`)
5. Merge slim trades parquet for the playback tape (`nemo_trades/`), keyed by `trade_id`, tagged with `file_id` so remove can subtract one file
6. Upsert `nemo-library.sqlite` and roll up `ListCatalog` from the `files` table

Flow (Binance Vision): `ImportVision` builds `https://data.binance.vision/data/futures/um/{monthly|daily}/trades/{SYMBOL}/...zip` on the engine (the UI URL is preview-only). The zip streams into `data/tmp/binance-vision` with SHA-256 `.CHECKSUM` verify, the CSV is extracted (zip-slip rejected), then the local CSV flow runs. `source_path` is the extracted file. Re-import of the same archive skips a matching zip. Tests must not hit the live CDN.

Consecutive daily files still merge into one instrument Parquet. Each file keeps its own library row and `file_id` on stored trades.

## Serve

Each WebSocket connection gets `SessionHello`, then `SocketFrame` commands:

| Command | Effect |
| --- | --- |
| `ImportCsv` | Ingest path on disk with provider / dataset / granularity / period; returns `file_id` and `path` |
| `ImportVision` | Download one um trades zip from data.binance.vision, extract, ingest; same result as `ImportCsv` |
| `ListCatalog` | Instrument rollup from SQLite |
| `ListFiles` | Flat file-manager rows |
| `RemoveFile` | Drop SQLite row + that `file_id` from Parquet; rebuild bars |
| `MoveFile` | Update taxonomy columns only |
| `QueryBars` | Ack + snapshot `BarBatch` (1m resampled to the requested step and range); warms the playback tape |
| `StartPlayback` | Prepare/resume the clock (awaits a warm tape if QueryBars already ran); ack; `PlaybackState`; trade tape; bar deltas only when there was no snapshot for this tape |
| `StopPlayback` | Pause: freeze cursor, `PlaybackState { playing: false }`, ack |
| `ResetPlayback` | Rewind to session start, empty trade tape, ack (`PlaybackAck` like pause). Does not re-send bars |
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
- Catalog ingest (Nautilus wrangler + parquet) and `file_id` tagging
- Binance Vision URL/path lockstep, mocked download/checksum/extract, um-trades-only `import_vision`
- Library CRUD, unique path, period display/key, catalog rollup, merge then remove, move-is-metadata
- WebSocket hello / import / query / list-remove-move / ImportVision; reject disabled datasets
- Playback clock (virtual time): 60x pacing, pause/resume cursor, Stop rewind then Play from start (no bar snapshot on reset), restart at end, speed rebase, trade window, `PLAYBACK_FAILED`, skip due-bar frames after a snapshot, vectorized timestamps at 44633 bars
- WebSocket play → pause → play keeps the cursor; play → reset → play restarts at range start; QueryBars then Play does not re-stream bars
- Console banner, color markup, Ctrl+C / shutdown event
- Protobuf round-trip vs golden bytes (`src/proto/testdata/golden_bar_batch.bin`)
