import { define, html } from "hybrids";
import { refreshLibrary } from "../library/select.ts";
import { importReady, periodFromInput } from "../library/taxonomy.ts";
import { engineApi } from "../session.ts";
import { setInstrument, setStatus } from "../store.ts";
import { fieldCss, taxonomyFields } from "./taxonomy-fields.ts";

export type ImportModalHost = HTMLElement & {
  path: string;
  provider: string;
  futures: string;
  granularity: string;
  periodValue: string;
};

function draft(host: ImportModalHost) {
  return {
    path: host.path,
    provider: host.provider || "Binance",
    dataset: host.futures || "trades",
    granularity: host.granularity || "monthly",
    period: periodFromInput(host.granularity || "monthly", host.periodValue),
  };
}

export function openImportModal(host: ImportModalHost, path = ""): void {
  host.path = path;
  host.provider = "Binance";
  host.futures = "trades";
  if (!host.granularity) {
    host.granularity = "monthly";
  }
  const dialog = host.shadowRoot?.querySelector("dialog");
  dialog?.showModal();
}

async function importCsv(host: ImportModalHost) {
  if (!engineApi || !importReady(draft(host))) {
    return;
  }
  const path = host.path.trim();
  try {
    setStatus("Importing CSV…");
    const result = await engineApi.importCsv({
      path,
      provider: host.provider || "Binance",
      dataset: host.futures,
      granularity: host.granularity,
      period: periodFromInput(host.granularity, host.periodValue),
    });
    setStatus(`Imported ${result.tradeCount} trades`);
    setInstrument(result.instrumentId);
    await refreshLibrary(engineApi);
    host.dispatchEvent(new CustomEvent("imported", { detail: { path, result }, bubbles: true, composed: true }));
    host.shadowRoot?.querySelector("dialog")?.close();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function setPath(host: ImportModalHost, event: Event): void {
  host.path = (event.target as HTMLInputElement).value;
}

function onImportClick(host: ImportModalHost): void {
  void importCsv(host);
}

export const NemoImportModal = define({
  tag: "nemo-import-modal",
  path: "",
  provider: "Binance",
  futures: "trades",
  granularity: "monthly",
  periodValue: "",
  render: (host: ImportModalHost) => html`
    <dialog>
      <form method="dialog">
        <h2>Import Data</h2>
        <label class="wide">
          CSV path
          <input
            data-field="path"
            value="${host.path}"
            placeholder="E:\\data\\BTCUSDC-trades-2026-08.csv"
            oninput="${setPath}"
          />
        </label>
        ${taxonomyFields(host)}
        <div class="actions">
          <button type="submit" value="cancel">Cancel</button>
          <button type="button" data-action="import" disabled="${!importReady(draft(host))}" onclick="${onImportClick}">
            Import
          </button>
        </div>
      </form>
    </dialog>
  `.css`
    ${fieldCss}
    dialog {
      width: min(36rem, calc(100vw - 2rem));
      background: #0c1a26;
      color: #e8eef5;
      border: 1px solid #2a4158;
      border-radius: 6px;
      padding: 1rem 1.1rem 1.1rem;
    }
    form {
      display: grid;
      gap: 0.75rem;
    }
    h2 {
      margin: 0 0 0.25rem;
      font-size: 1.05rem;
      font-weight: 600;
    }
    .actions {
      display: flex;
      justify-content: end;
      gap: 0.6rem;
      margin-top: 0.4rem;
    }
  `,
});
