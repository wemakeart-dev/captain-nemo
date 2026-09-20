# Web application

The web layer is a Vite app rooted at `src/web`. It is a HybridsJS custom-element UI. Historical arrays never live on component properties; they live in `src/web/store.ts`.

## Responsibilities

- Connect to the browser worker over `postMessage` RPC for commands (connect, import, list catalog, query bars, play, pause, speed)
- Receive conflated protobuf `ArrayBuffer` frames on a dedicated `postMessage` channel (`{ nemo: "frame", buffer }`)
- Decode frames with generated protobuf-es types immediately before updating the chart store
- Render aggregated OHLCV candlesticks with Apache ECharts (`large`, `progressive`, time `dataZoom`)
- Send CSV import as a local filesystem path string, never as file bytes. A native `<input type="file">` is deferred: the browser cannot pass a real disk path to the engine.

## Layout

| File | Role |
| --- | --- |
| `src/web/main.ts` | Boots the worker client and registers `<nemo-app>` |
| `src/web/components/app.ts` | Shell |
| `src/web/components/controls.ts` | Engine URL, CSV path, catalog, playback |
| `src/web/components/chart.ts` | ECharts host; `observe` applies store snapshots |
| `src/web/components/status.ts` | Connection / import status |
| `src/web/chart/options.ts` | Pure option builder used by tests |
| `src/web/store.ts` | Module-level candles, trades, playback cursor, speed, `resolvePlayArgs` |
| `src/web/worker-client.ts` | Worker + RPC + transferable frame listener |

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
- `importCsv(path)`
- `listCatalog()`
- `queryBars(instrumentId, barStep)`
- `play` / `pause` / `setSpeed`

`chartStore.speed` is the speed dropdown’s source of truth (default 1). Play sends that value, not a stale `PlaybackState`. If playback is paused mid-range, `resolvePlayArgs` sends the current `cursorNs` so the engine resumes instead of rewinding to the first bar. Play is a no-op while `playback.playing` is true. Pause sets status to Paused; a `PLAYBACK_FAILED` engine error sets status to Playback failed.

`PlaybackState` frames also update `chartStore.speed` when the engine reports a positive speed.

## Run

```powershell
yarn web:dev
```

The worker TypeScript is bundled by Vite (`worker.format = "es"`). Regenerated protobuf types live in `src/generated/ts` after `yarn proto:generate`.

## Tests

`yarn test:web` runs Vitest + happy-dom against option builders, Hybrids status rendering, golden `BarBatch` store application, `PlaybackState` / trade-tape updates, and `resolvePlayArgs` resume vs restart.
