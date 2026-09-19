<!-- HEADER -->
<p align="center">
    <a
        target="_blank"
        rel="noopener noreferrer"
        href="https://en.wikipedia.org/wiki/Twenty_Thousand_Leagues_Under_the_Seas"
    >
        <img
            alt="captain-nemo-header"
            width="250px"
            src="https://res.cloudinary.com/wemakeart/image/upload/v1789832597/github/captain-nemo/captain-nemo-header_cpmk7c.webp"
        >
    </a>
</p>

# Captain Nemo

Captain Nemo is a local-only research terminal. It wraps [Nautilus Trader](https://nautilustrader.io/) so you can visualize Binance Vision USD-M futures trade history and later train automated strategies against the same catalog.

v1 runs on **Windows 10 x64** only. The engine binds `127.0.0.1`. There is no cloud service and no live exchange session.

## Layers

| Layer | Path | Role |
| --- | --- | --- |
| Web | [`src/web`](src/web) | HybridsJS UI and Apache ECharts candlestick chart |
| Worker | [`src/worker`](src/worker) | Browser Web Worker: WebSocket owner, conflation, transferable protobuf frames |
| Engine | [`src/engine`](src/engine) | Python / Nautilus ingest, Parquet catalog, paced playback, protobuf WebSocket |

Wire types are generated from [`src/proto`](src/proto). See:

- [Web application](__docs/WEB.md)
- [Worker layer](__docs/WORKER.md)
- [Nautilus engine](__docs/ENGINE.md)

## Stack

- **Yarn 4** for JavaScript/TypeScript (Vite, Hybrids, ECharts, Vitest, Buf, protobuf-es)
- **uv** for Python (Nautilus Trader wheel, pytest, protobuf, websockets)
- Protobuf as the single source of truth between engine, worker, and web
- WebSocket binary frames on localhost

Do not use npm, pip, pnpm, poetry, or conda as project package managers.

## Windows 10 setup

1. Install Node.js 22 LTS. Enable Corepack: `corepack enable`
2. Install Python 3.12 **64-bit**
3. Install [uv](https://docs.astral.sh/uv/)
4. From the repo root:

```powershell
yarn install
yarn proto:generate
uv sync --project src/engine
```

Nautilus Trader is installed as a **prebuilt wheel** (`nautilus-trader` 1.221–1.231.x). Do not install Rust or MSVC for this repository.

## Run

Two processes:

```powershell
uv run --directory src/engine python -m captain_nemo_engine
yarn web:dev
```

Open `http://127.0.0.1:5173`. Connect to `ws://127.0.0.1:8765`, import a Binance Vision UM trades CSV (daily or monthly, headered or headerless), load the chart, then play.

CSV files stay on disk. The UI sends a filesystem path; it does not upload the file through the browser.

## Tests

```powershell
yarn proto:generate
yarn test:web
yarn test:worker
yarn test:engine
```

Pull requests into `master` run those three suites in parallel via GitHub Actions.

## Watch protobuf schemas

```powershell
yarn proto:watch
```
