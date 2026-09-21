import { define, html } from "hybrids";
import { refreshLibrary, reloadSelectedFile } from "../library/select.ts";
import { engineApi } from "../session.ts";
import {
  applyPlaybackAck,
  chartStore,
  hasSelectedFile,
  resolvePlayArgs,
  setBarStep,
  setConnected,
  setInstrument,
  setPlaybackBusy,
  setSpeed,
  setStatus,
  subscribeKeys,
} from "../store.ts";
import { openImportModal, type ImportModalHost } from "./import-modal.ts";
import "./import-modal.ts";

type ControlsHost = HTMLElement & {
  url: string;
  csvPath: string;
};

let connecting = false;
let autoStarted = false;

const CONTROL_KEYS: (keyof typeof chartStore)[] = [
  "connected",
  "catalog",
  "instrumentId",
  "barStep",
  "speed",
  "selectedFileId",
  "playbackBusy",
];

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
    await refreshLibrary(engineApi);
  } catch (error) {
    setConnected(false);
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    connecting = false;
  }
}

function openImport(host: ControlsHost) {
  const csvInput = host.shadowRoot?.querySelector("[data-field=csv]") as HTMLInputElement | null;
  const path = (csvInput?.value || host.csvPath).trim();
  host.csvPath = path;
  const modal = host.shadowRoot?.querySelector("nemo-import-modal") as ImportModalHost | null;
  if (modal) {
    openImportModal(modal, path);
  }
}

export async function play() {
  if (!engineApi || !hasSelectedFile()) {
    return;
  }
  if (chartStore.playback?.playing || chartStore.playbackBusy) {
    return;
  }
  setPlaybackBusy(true);
  try {
    const args = resolvePlayArgs(chartStore);
    const ack = await engineApi.play(chartStore.instrumentId, chartStore.barStep, args.speed, args.startNs, args.endNs);
    applyPlaybackAck(ack);
    setStatus("Playing");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message.includes("PLAYBACK_FAILED") ? "Playback failed" : message);
  } finally {
    setPlaybackBusy(false);
  }
}

export async function pause() {
  if (!engineApi || chartStore.playbackBusy) {
    return;
  }
  setPlaybackBusy(true);
  try {
    const ack = await engineApi.pause();
    applyPlaybackAck(ack);
    setStatus("Paused");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    setPlaybackBusy(false);
  }
}

export async function stopPlayback() {
  if (!engineApi || chartStore.playbackBusy) {
    return;
  }
  setPlaybackBusy(true);
  try {
    const ack = await engineApi.resetPlayback();
    applyPlaybackAck(ack);
    setStatus("Stopped");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    setPlaybackBusy(false);
  }
}

function playbackDisabled(): boolean {
  return !chartStore.connected || !hasSelectedFile() || chartStore.playbackBusy;
}

function onConnectClick(host: ControlsHost) {
  void connectEngine(host);
}

function onUrlInput(host: ControlsHost, event: Event) {
  host.url = (event.target as HTMLInputElement).value;
}

function onCsvInput(host: ControlsHost, event: Event) {
  host.csvPath = (event.target as HTMLInputElement).value;
}

function onInstrumentChange(_host: ControlsHost, event: Event) {
  setInstrument((event.target as HTMLSelectElement).value);
}

export async function changeBarStep(step: string): Promise<void> {
  setBarStep(step);
  if (!engineApi) {
    return;
  }
  await reloadSelectedFile(engineApi, step);
}

function onStepChange(_host: ControlsHost, event: Event) {
  void changeBarStep((event.target as HTMLSelectElement).value);
}

function onSpeedChange(_host: ControlsHost, event: Event) {
  const speed = Number((event.target as HTMLSelectElement).value);
  setSpeed(speed);
  if (engineApi) {
    void engineApi.setSpeed(speed);
  }
}

function bindImportModal(host: ControlsHost) {
  const modal = host.shadowRoot?.querySelector("nemo-import-modal");
  if (modal && !(modal as HTMLElement).dataset.bound) {
    (modal as HTMLElement).dataset.bound = "true";
    modal.addEventListener("imported", (event) => {
      const path = (event as CustomEvent<{ path: string }>).detail.path;
      host.csvPath = path;
    });
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
          <input data-field="url" value="${host.url}" oninput="${onUrlInput}" />
        </label>
        <button type="button" data-action="connect" onclick="${onConnectClick}">Connect</button>
        <label class="wide">
          CSV path
          <input data-field="csv" value="${host.csvPath}" placeholder="E:\\data\\BTCUSDC-trades-2026-08.csv" oninput="${onCsvInput}" />
        </label>
        <button type="button" data-action="import" disabled="${!chartStore.connected}" onclick="${openImport}">Import</button>
        <label>
          Instrument
          <select data-field="instrument" onchange="${onInstrumentChange}">
            ${chartStore.catalog.map(
              (item) => html`<option value="${item.instrumentId}" selected="${item.instrumentId === chartStore.instrumentId}">
                ${item.instrumentId}
              </option>`,
            )}
          </select>
        </label>
        <label>
          Bar step
          <select data-field="step" onchange="${onStepChange}">
            ${["1m", "5m", "15m", "1h"].map(
              (step) => html`<option value="${step}" selected="${step === chartStore.barStep}">${step}</option>`,
            )}
          </select>
        </label>
        <button type="button" data-action="play" disabled="${playbackDisabled()}" onclick="${play}">Play</button>
        <button type="button" data-action="pause" disabled="${playbackDisabled()}" onclick="${pause}">Pause</button>
        <button type="button" data-action="stop" disabled="${playbackDisabled()}" onclick="${stopPlayback}">Stop</button>
        <label>
          Speed
          <select data-field="speed" onchange="${onSpeedChange}">
            ${[1, 2, 5, 10, 60].map(
              (speed) => html`<option value="${speed}" selected="${speed === chartStore.speed}">${speed}x</option>`,
            )}
          </select>
        </label>
      </form>
      <nemo-import-modal></nemo-import-modal>
    `.css`
      :host {
        display: block;
        min-width: 0;
        max-width: 100%;
      }
      form {
        display: flex;
        flex-wrap: nowrap;
        gap: 0.75rem 1rem;
        align-items: end;
        width: 100%;
        min-width: 0;
      }
      form > :not(.wide) {
        flex: none;
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
      .wide {
        flex: 1 1 0%;
        min-width: 0;
      }
      .wide input {
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
      }
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
    connect: (host: ControlsHost, _key, invalidate) => {
      const unsubscribe = subscribeKeys(CONTROL_KEYS, invalidate);
      if (!autoStarted) {
        autoStarted = true;
        void connectEngine(host);
      }
      return unsubscribe;
    },
    observe: (host: ControlsHost) => {
      bindImportModal(host);
    },
  },
});
