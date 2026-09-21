# Web application

The web layer is a Vite app rooted at `src/web`. It is a HybridsJS custom-element UI. Historical arrays never live on component properties; they live in `src/web/store.ts`.

## Responsibilities

- Connect to the browser worker over `postMessage` RPC for commands (connect, import, list catalog, list/remove/move files, query bars, play, pause, reset, speed)
- Receive conflated protobuf `ArrayBuffer` batches on a dedicated `postMessage` channel (`{ nemo: "frames", buffers, kinds }`)
- Decode frames with generated protobuf-es types immediately before updating the chart store
- Render aggregated OHLCV candlesticks with Apache ECharts (`large`, `progressive`, time `dataZoom`)
- Send CSV import as a local filesystem path string, never as file bytes. A native `<input type="file">` is deferred: the browser cannot pass a real disk path to the engine. Binance Vision import sends symbol / market / taxonomy fields; the engine downloads the zip.

## Layout

The shell is header, controls, then a workspace:

```
header
nemo-controls
nemo-workspace  →  nemo-file-manager | nemo-chart
```

Workspace is `grid-template-columns: auto minmax(0, 1fr)` filling the remaining viewport row (`minmax(0, 1fr)`). The file manager collapse control is a left/right arrow: expanded ~17rem, collapsed a ~2.5rem strip. Folder expand/collapse is independent of that sidebar toggle.

The shell (`html`/`body`/`nemo-app`) is locked to the viewport (`height: 100%`, `overflow: hidden`). `nemo-controls` stays on one row: CSV path is the only flexible field (`flex: 1 1 0%`, `min-width: 0`) so Engine, Import, playback, and speed stay visible. `nemo-chart` has `min-width: 0` and a `ResizeObserver` on `.plot` so ECharts shrinks horizontally when the sidebar opens.

| File | Role |
| --- | --- |
| `src/web/main.ts` | Boots the worker client and registers `<nemo-app>` |
| `src/web/components/app.ts` | Shell |
| `src/web/components/controls.ts` | Engine URL, CSV path, catalog, Play / Pause / Stop |
| `src/web/components/import-modal.ts` | Import Data `<dialog>` (local CSV or Binance Vision) |
| `src/web/components/workspace.ts` | File manager + chart grid |
| `src/web/components/file-manager.ts` | Sidebar chrome, bottom action bar, move dialog |
| `src/web/components/file-tree.ts` | Folder tree; file-name click sets `activeFileId` |
| `src/web/components/chart.ts` | ECharts host; `observe` applies store snapshots |
| `src/web/components/status.ts` | Connection / import status |
| `src/web/library/tree.ts` | Flat `FileEntry[]` → nested tree |
| `src/web/library/actions.ts` | Enable Select Data / Remove / Move for the active file |
| `src/web/library/taxonomy.ts` | Period formatting and import validation |
| `src/web/library/vision.ts` | Binance Vision URL constructor (lockstep with the engine) |
| `src/web/chart/options.ts` | Pure option builder used by tests |
| `src/web/store.ts` | Candles, trades, files, `activeFileId`, `selectedFileId`, playback, `resolvePlayArgs` |
| `src/web/worker-client.ts` | Worker + RPC + transferable frame listener |

## Import Data modal

**Import** always opens the modal. The toolbar CSV path field is unchanged. The modal has a Local CSV / Binance Vision toggle.

Local CSV:

- If the toolbar CSV path is non-empty, the modal path is prefilled.
- If it is empty, the user must enter it in the modal.
- Modal Import stays disabled until path, provider, futures=`trades`, and a complete period are set.

Binance Vision:

- Symbol is required. Market is `spot` / `um` / `cm` with only `um` enabled. Futures is still only `trades`.
- A read-only URL is constructed from those fields (`https://data.binance.vision/data/futures/um/...`).
- Import stays disabled until symbol, um, trades, and a complete period are set.
- The engine downloads one zip for that period, extracts it under `data/tmp/binance-vision`, and ingests the CSV.

Successful import writes the filesystem path (local or extracted) back to the toolbar field, then `ListFiles` + `ListCatalog`.

Fields: source toggle; CSV path or symbol + market + URL; Provider (`Binance` only); Futures (all Binance Vision names shown, only `trades` enabled); Time period Monthly vs Daily (`<input type="month">` / `type="date">`, stored/displayed as `MM-YYYY` / `DD-MM-YYYY`).

## File manager

The tree is virtual taxonomy: `Binance` → `trades` → `daily|monthly` → period → file name. CSV files stay on disk; Move only updates SQLite columns.

Check, cross, and arrow are **not** per-file. They sit once in a bottom bar, outside the directory tree, as `<text> <icon>`:

- **Select Data** — sets `selectedFileId` and `queryBars` for that file’s `start_ns`/`end_ns` (this is what used to be **Load chart**).
- **Remove** — `RemoveFile`. If that file was on the chart, selection and candles clear. The user’s CSV (and any Vision extract) is not deleted.
- **Move** — pick an existing period folder or create a new branch with the same taxonomy controls.

Click a file name to set `activeFileId` (row highlight). The three buttons stay disabled until then; they then apply to that file. A gold file name is the chart’s `selectedFileId`. Play / Pause / Stop stay disabled until a file is selected for the chart.

Hybrids: file manager, file tree, and controls bind clicks in the template (`onclick="${handler}"`), not `observe` + `querySelector`. Controls subscribe to `connected` / `catalog` / `instrumentId` / `barStep` / `speed` / `selectedFileId` / `playbackBusy`; status to `status` / `connected`. Playback ticks do not rebuild the toolbar. Collapse state is a host property (`collapsedIds`) that render reads. `subscribeKeys` invalidates only on `files` / `activeFileId` / `selectedFileId` (tree) or `activeFileId` / `fileManagerOpen` (sidebar), so playback ticks do not rebuild the list. Import Data and taxonomy fields use the same template `oninput` / `onchange` pattern.

## Data path

1. Worker transfers a batched protobuf `ArrayBuffer[]` (`{ nemo: "frames" }`)
2. `applyFrameBuffers` decodes each `SocketFrame` then notifies once
3. `BarBatch.snapshot` replaces candles (QueryBars is the chart source of truth). Deltas append in order (`O(k)`); timestamps already in the snapshot are ignored
4. `TradeBatch` keeps the last 200 trades
5. `PlaybackState` drives the cursor. ECharts `setOption` runs only when the candles array identity changes. Playback ticks position a DOM overlay line with `convertToPixel` and must not call `setOption` — a series/`markLine` patch restarts `large`/`progressive` candlestick drawing and flashes in the zoomed-out view
6. Play / Pause / Stop apply `PlaybackAck.playing` immediately and ignore a second click while an RPC is in flight

Candlestick data is `[timestampMs, open, close, low, high]`. Decimal strings from protobuf become numbers only at this boundary.

## Commands

Controls call `engineApi` (`WorkerApi`):

- `connect(url)` default `ws://127.0.0.1:8765`
- `importCsv({ path, provider, dataset, granularity, period })`
- `importVision({ symbol, tradingType, dataset, granularity, period, provider })`
- `listCatalog()` / `listFiles()` / `removeFile` / `moveFile`
- `queryBars(instrumentId, barStep, startNs, endNs)`
- `play` / `pause` / `resetPlayback` / `setSpeed`

Bar step changes call `queryBars` for the selected file immediately (same path as Select Data). Stop / Play are not required to resample the chart.

`chartStore.speed` is the speed dropdown’s source of truth (default 1). Play sends that value, not a stale `PlaybackState`. If playback is paused mid-range, `resolvePlayArgs` sends the current `cursorNs` so the engine resumes instead of rewinding to the first bar. After Stop / `ResetPlayback`, Play starts from the selected file `start_ns`. Play is a no-op while `playback.playing` is true or while a playback RPC is in flight. Pause sets status to Paused; Stop sets status to Stopped; a `PLAYBACK_FAILED` engine error sets status to Playback failed.

`PlaybackAck` updates `chartStore.playback.playing` as soon as the RPC returns. `PlaybackState` frames also update `chartStore.speed` when the engine reports a positive speed.

## Run

```powershell
yarn web:dev
```

The worker TypeScript is bundled by Vite (`worker.format = "es"`). Regenerated protobuf types live in `src/generated/ts` after `yarn proto:generate`.

## Tests

`yarn test:web` runs Vitest + happy-dom against option builders (candlestick-only series plus overlay cursor clipping so playback ticks do not `setOption`), Hybrids status / file-manager / controls / modal rendering, viewport layout (CSV shrink, no 480px floor), Vision URL construction, golden `BarBatch` store application, `PlaybackState` / trade-tape updates, ordered / redundant candle merges at 44633 bars, batched frame notify, in-flight Play / Pause / Stop, bar-step reload of the selected file, toolbar stability on playback ticks, file-tree shape and folder collapse, global action-bar gating (click file name, then Select Data / Remove / Move), and `resolvePlayArgs` resume vs Stop restart.
