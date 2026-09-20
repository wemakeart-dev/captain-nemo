import { define, html } from "hybrids";
import { engineApi } from "../session.ts";
import {
  chartStore,
  resolvePlayArgs,
  setBarStep,
  setCatalog,
  setConnected,
  setInstrument,
  setSpeed,
  setStatus,
  subscribe,
} from "../store.ts";

type ControlsHost = HTMLElement & {
  url: string;
  csvPath: string;
};

let connecting = false;
let autoStarted = false;

async function connectEngine(host: ControlsHost) {
  if (!engineApi) {
    setStatus("Worker is not ready");
    return;
  }
  if (connecting) {
    return;
  }
  connecting = true;
  try {
    setStatus("Connecting…");
    const hello = await engineApi.connect(host.url);
    setConnected(true);
    setStatus(`Engine v${hello.version}`);
    const items = await engineApi.listCatalog();
    setCatalog(items);
  } catch (error) {
    setConnected(false);
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    connecting = false;
  }
}

async function importCsv(host: ControlsHost) {
  if (!engineApi) {
    return;
  }
  const csvInput = host.shadowRoot?.querySelector("[data-field=csv]") as HTMLInputElement | null;
  const path = (csvInput?.value || host.csvPath).trim();
  host.csvPath = path;
  if (!path) {
    setStatus("CSV path is required");
    return;
  }
  try {
    setStatus("Importing CSV…");
    const result = await engineApi.importCsv(path);
    setStatus(`Imported ${result.tradeCount} trades`);
    setInstrument(result.instrumentId);
    const items = await engineApi.listCatalog();
    setCatalog(items);
    await engineApi.queryBars(result.instrumentId, chartStore.barStep);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

async function loadBars() {
  if (!engineApi || !chartStore.instrumentId) {
    return;
  }
  try {
    setStatus("Loading bars…");
    const result = await engineApi.queryBars(chartStore.instrumentId, chartStore.barStep);
    setStatus(`Loaded ${result.barCount} bars`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

async function play() {
  if (!engineApi || !chartStore.instrumentId) {
    return;
  }
  if (chartStore.playback?.playing) {
    return;
  }
  try {
    const args = resolvePlayArgs(chartStore);
    await engineApi.play(chartStore.instrumentId, chartStore.barStep, args.speed, args.startNs);
    setStatus("Playing");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message.includes("PLAYBACK_FAILED") ? "Playback failed" : message);
  }
}

async function pause() {
  if (!engineApi) {
    return;
  }
  try {
    await engineApi.pause();
    setStatus("Paused");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function bindControls(host: ControlsHost) {
  const root = host.shadowRoot;
  if (!root) {
    return;
  }
  const connectBtn = root.querySelector("[data-action=connect]") as HTMLButtonElement | null;
  if (connectBtn) {
    connectBtn.onclick = () => {
      void connectEngine(host);
    };
  }
  const importBtn = root.querySelector("[data-action=import]") as HTMLButtonElement | null;
  if (importBtn) {
    importBtn.onclick = () => {
      void importCsv(host);
    };
  }
  const loadBtn = root.querySelector("[data-action=load]") as HTMLButtonElement | null;
  if (loadBtn) {
    loadBtn.onclick = () => {
      void loadBars();
    };
  }
  const playBtn = root.querySelector("[data-action=play]") as HTMLButtonElement | null;
  if (playBtn) {
    playBtn.onclick = () => {
      void play();
    };
  }
  const pauseBtn = root.querySelector("[data-action=pause]") as HTMLButtonElement | null;
  if (pauseBtn) {
    pauseBtn.onclick = () => {
      void pause();
    };
  }
  const urlInput = root.querySelector("[data-field=url]") as HTMLInputElement | null;
  if (urlInput) {
    urlInput.oninput = () => {
      host.url = urlInput.value;
    };
  }
  const csvInput = root.querySelector("[data-field=csv]") as HTMLInputElement | null;
  if (csvInput) {
    csvInput.oninput = () => {
      host.csvPath = csvInput.value;
    };
  }
  const instrumentSelect = root.querySelector("[data-field=instrument]") as HTMLSelectElement | null;
  if (instrumentSelect) {
    instrumentSelect.onchange = () => {
      setInstrument(instrumentSelect.value);
    };
  }
  const stepSelect = root.querySelector("[data-field=step]") as HTMLSelectElement | null;
  if (stepSelect) {
    stepSelect.onchange = () => {
      setBarStep(stepSelect.value);
    };
  }
  const speedSelect = root.querySelector("[data-field=speed]") as HTMLSelectElement | null;
  if (speedSelect) {
    speedSelect.onchange = () => {
      const speed = Number(speedSelect.value);
      setSpeed(speed);
      if (engineApi) {
        void engineApi.setSpeed(speed);
      }
    };
  }
}

export const NemoControls = define({
  tag: "nemo-controls",
  url: "ws://127.0.0.1:8765",
  csvPath: "",
  render: {
    value: (host: ControlsHost) => html`
      <form>
        <label>
          Engine
          <input data-field="url" value="${host.url}" />
        </label>
        <button type="button" data-action="connect">Connect</button>
        <label class="wide">
          CSV path
          <input data-field="csv" value="${host.csvPath}" placeholder="E:\\data\\BTCUSDC-trades-2026-08.csv" />
        </label>
        <button type="button" data-action="import" disabled="${!chartStore.connected}">Import</button>
        <label>
          Instrument
          <select data-field="instrument">
            ${chartStore.catalog.map(
              (item) => html`<option value="${item.instrumentId}" selected="${item.instrumentId === chartStore.instrumentId}">
                ${item.instrumentId}
              </option>`,
            )}
          </select>
        </label>
        <label>
          Bar step
          <select data-field="step">
            ${["1m", "5m", "15m", "1h"].map(
              (step) => html`<option value="${step}" selected="${step === chartStore.barStep}">${step}</option>`,
            )}
          </select>
        </label>
        <button type="button" data-action="load" disabled="${!chartStore.connected}">Load chart</button>
        <button type="button" data-action="play" disabled="${!chartStore.connected}">Play</button>
        <button type="button" data-action="pause" disabled="${!chartStore.connected}">Pause</button>
        <label>
          Speed
          <select data-field="speed">
            ${[1, 2, 5, 10, 60].map(
              (speed) => html`<option value="${speed}" selected="${speed === chartStore.speed}">${speed}x</option>`,
            )}
          </select>
        </label>
      </form>
    `.css`
      form {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem 1rem;
        align-items: end;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        color: #9eb3c7;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .wide { flex: 1; min-width: 18rem; }
      input, select, button {
        font: inherit;
        color: #e8eef5;
        background: #10202e;
        border: 1px solid #2a4158;
        border-radius: 4px;
        padding: 0.45rem 0.6rem;
      }
      button {
        cursor: pointer;
        background: #16324a;
      }
      button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
    connect: (_host: ControlsHost, _key, invalidate) => subscribe(invalidate),
    observe: (host: ControlsHost) => {
      bindControls(host);
      if (!autoStarted) {
        autoStarted = true;
        void connectEngine(host);
      }
    },
  },
});
