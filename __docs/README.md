# Documentation

Captain Nemo is a local research terminal: a Hybrids UI, a browser worker, and a Nautilus engine, talking protobuf over localhost. This folder is the layer map. Open the doc that matches the code you are changing; do not treat this index as a substitute for those files.

| Layer | Code | Doc | Covers |
| --- | --- | --- | --- |
| Web | [`src/web`](../src/web) | [WEB.md](WEB.md) | Hybrids controls, file manager, Import Data modal, chart, `chartStore`, ECharts options, worker RPC from the UI. CSV import is a filesystem path string or a Binance Vision download (um trades). Select loads the chart. |
| Worker | [`src/worker`](../src/worker) | [WORKER.md](WORKER.md) | Browser `Worker`, WebSocket ownership, command correlation, frame conflation, transferable protobuf bytes. |
| Engine | [`src/engine`](../src/engine) | [ENGINE.md](ENGINE.md) | CSV ingest, Binance Vision download, SQLite library (`nemo-library.sqlite`), Parquet catalog, paced playback, protobuf WebSocket server. |
| Wire | [`src/proto`](../src/proto) | (see all three) | `captain_nemo.v1` schemas. Generated code lives in `src/generated`; regenerate with `yarn proto:generate`. |

## Pick a doc when

- UI, chart, store, file manager, or controls → [WEB.md](WEB.md)
- `postMessage` RPC, conflation, or the engine socket in the browser → [WORKER.md](WORKER.md)
- CSV, SQLite library, catalog, Binance Vision download, bars, playback clock, or the Python process → [ENGINE.md](ENGINE.md)
- Frame fields, command oneofs, or golden bytes → start in proto, then the layer that encodes or decodes that message

Setup, Yarn/uv, and how to run both processes are in the root [README.md](../README.md). Layer run/test commands are repeated in each layer doc (`yarn web:dev`, `yarn test:web`, `yarn test:worker`, `yarn test:engine`).
