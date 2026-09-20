# Web application

The web layer is a Vite app rooted at `src/web`. It is a HybridsJS custom-element UI. Historical arrays never live on component properties; they live in `src/web/store.ts`.

## Responsibilities

- Connect to the browser worker over `postMessage` RPC for commands (connect, import, list catalog, list/remove/move files, query bars, play, pause, reset, speed)
- Receive conflated protobuf `ArrayBuffer` frames on a dedicated `postMessage` channel (`{ nemo: "frame", buffer }`)
- Decode frames with generated protobuf-es types immediately before updating the chart store
- Render aggregated OHLCV candlesticks with Apache ECharts (`large`, `progressive`, time `dataZoom`)
- Send CSV import as a local filesystem path string, never as file bytes. A native `<input type="file">` is deferred: the browser cannot pass a real disk path to the engine.

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
| `src/web/components/import-modal.ts` | Import Data `<dialog>` (provider / futures / period) |
| `src/web/components/workspace.ts` | File manager + chart grid |
| `src/web/components/file-manager.ts` | Sidebar chrome, bottom action bar, move dialog |
| `src/web/components/file-tree.ts` | Folder tree; file-name click sets `activeFileId` |
| `src/web/components/chart.ts` | ECharts host; `observe` applies store snapshots |
| `src/web/components/status.ts` | Connection / import status |
| `src/web/library/tree.ts` | Flat `FileEntry[]` → nested tree |
| `src/web/library/actions.ts` | Enable Select Data / Remove / Move for the active file |
| `src/web/library/taxonomy.ts` | Period formatting and import validation |
| `src/web/chart/options.ts` | Pure option builder used by tests |
| `src/web/store.ts` | Candles, trades, files, `activeFileId`, `selectedFileId`, playback, `resolvePlayArgs` |
| `src/web/worker-client.ts` | Worker + RPC + transferable frame listener |

## Import Data modal

**Import** always opens the modal. Path handling:

- If the toolbar CSV path is non-empty, the modal path is prefilled.
- If it is empty, the user must enter it in the modal.
- Modal Import stays disabled until path, provider, futures=`trades`, and a complete period are set.
- Successful import writes the path back to the toolbar field, then `ListFiles` + `ListCatalog`.

Fields: CSV path; Provider (`Binance` only); Futures (all Binance Vision names shown, only `trades` enabled); Time period Monthly vs Daily (`<input type="month">` / `type="date">`, stored/displayed as `MM-YYYY` / `DD-MM-YYYY`).

## File manager

The tree is virtual taxonomy: `Binance` → `trades` → `daily|monthly` → period → file name. CSV files stay on disk; Move only updates SQLite columns.

Check, cross, and arrow are **not** per-file. They sit once in a bottom bar, outside the directory tree, as `<text> <icon>`:

- **Select Data** — sets `selectedFileId` and `queryBars` for that file’s `start_ns`/`end_ns` (this is what used to be **Load chart**).
- **Remove** — `RemoveFile`. If that file was on the chart, selection and candles clear. The user’s CSV is not deleted.
- **Move** — pick an existing period folder or create a new branch with the same taxonomy controls.

Click a file name to set `activeFileId` (row highlight). The three buttons stay disabled until then; they then apply to that file. A gold file name is the chart’s `selectedFileId`. Play / Pause / Stop stay disabled until a file is selected for the chart.

Hybrids: file manager and file tree bind clicks in the template (`onclick="${handler}"`), not `observe` + `querySelector`. Collapse state is a host property (`collapsedIds`) that render reads. `subscribeKeys` invalidates only on `files` / `activeFileId` / `selectedFileId` (tree) or `activeFileId` / `fileManagerOpen` (sidebar), so playback ticks do not rebuild the list. Import Data and taxonomy fields use the same template `oninput` / `onchange` pattern.

## Data path

1. Worker transfers a protobuf `ArrayBuffer`
2. `applyFrameBuffer` decodes a `SocketFrame`
3. `BarBatch.snapshot` replaces candles; deltas merge by timestamp
4. `TradeBatch` keeps the last 200 trades
5. `PlaybackState` drives the cursor mark line
6. ECharts `setOption` reads `chartStore.candles`

Candlestick data is `[timestampMs, open, close, low, high]`. Decimal strings from protobuf become numbers only at this boundary.

## Commands

Controls call `engineApi` (`WorkerApi`):

- `connect(url)` default `ws://127.0.0.1:8765`
- `importCsv({ path, provider, dataset, granularity, period })`
- `listCatalog()` / `listFiles()` / `removeFile` / `moveFile`
- `queryBars(instrumentId, barStep, startNs, endNs)`
- `play` / `pause` / `resetPlayback` / `setSpeed`

`chartStore.speed` is the speed dropdown’s source of truth (default 1). Play sends that value, not a stale `PlaybackState`. If playback is paused mid-range, `resolvePlayArgs` sends the current `cursorNs` so the engine resumes instead of rewinding to the first bar. After Stop / `ResetPlayback`, Play starts from the selected file `start_ns`. Play is a no-op while `playback.playing` is true. Pause sets status to Paused; Stop sets status to Stopped; a `PLAYBACK_FAILED` engine error sets status to Playback failed.

`PlaybackState` frames also update `chartStore.speed` when the engine reports a positive speed.

## Run

```powershell
yarn web:dev
```

The worker TypeScript is bundled by Vite (`worker.format = "es"`). Regenerated protobuf types live in `src/generated/ts` after `yarn proto:generate`.

## Tests

`yarn test:web` runs Vitest + happy-dom against option builders, Hybrids status / file-manager / controls / modal rendering, viewport layout (CSV shrink, no 480px floor), golden `BarBatch` store application, `PlaybackState` / trade-tape updates, file-tree shape and folder collapse, global action-bar gating (click file name, then Select Data / Remove / Move), and `resolvePlayArgs` resume vs Stop restart.
