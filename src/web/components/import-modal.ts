import { define, html } from "hybrids";
import { refreshLibrary } from "../library/select.ts";
import { importReady, periodFromInput, visionImportReady, type ImportSource } from "../library/taxonomy.ts";
import { TRADING_TYPES, visionDownloadUrl } from "../library/vision.ts";
import { engineApi } from "../session.ts";
import { setInstrument, setStatus } from "../store.ts";
import { fieldCss, taxonomyFields } from "./taxonomy-fields.ts";

export type ImportModalHost = HTMLElement & {
  source: ImportSource;
  path: string;
  symbol: string;
  tradingType: string;
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
    source: host.source || "path",
    symbol: host.symbol,
    tradingType: host.tradingType || "um",
  };
}

function canImport(host: ImportModalHost): boolean {
  const current = draft(host);
  return current.source === "vision" ? visionImportReady(current) : importReady(current);
}

export function openImportModal(host: ImportModalHost, path = ""): void {
  host.path = path;
  host.provider = "Binance";
  host.futures = "trades";
  host.tradingType = host.tradingType || "um";
  host.source = "path";
  if (!host.granularity) {
    host.granularity = "monthly";
  }
  const dialog = host.shadowRoot?.querySelector("dialog");
  dialog?.showModal();
}

async function runImport(host: ImportModalHost) {
  if (!engineApi || !canImport(host)) {
    return;
  }
  const current = draft(host);
  try {
    if (current.source === "vision") {
      setStatus("Downloading from Binance Vision…");
      const result = await engineApi.importVision({
        symbol: host.symbol.trim(),
        tradingType: host.tradingType || "um",
        dataset: host.futures,
        granularity: host.granularity,
        period: current.period,
        provider: host.provider || "Binance",
      });
      setStatus(`Imported ${result.tradeCount} trades`);
      setInstrument(result.instrumentId);
      await refreshLibrary(engineApi);
      const path = result.path || host.path.trim();
      host.dispatchEvent(new CustomEvent("imported", { detail: { path, result }, bubbles: true, composed: true }));
    } else {
      const path = host.path.trim();
      setStatus("Importing CSV…");
      const result = await engineApi.importCsv({
        path,
        provider: host.provider || "Binance",
        dataset: host.futures,
        granularity: host.granularity,
        period: current.period,
      });
      setStatus(`Imported ${result.tradeCount} trades`);
      setInstrument(result.instrumentId);
      await refreshLibrary(engineApi);
      host.dispatchEvent(
        new CustomEvent("imported", { detail: { path: result.path || path, result }, bubbles: true, composed: true }),
      );
    }
    host.shadowRoot?.querySelector("dialog")?.close();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function setPath(host: ImportModalHost, event: Event): void {
  host.path = (event.target as HTMLInputElement).value;
}

function setSymbol(host: ImportModalHost, event: Event): void {
  host.symbol = (event.target as HTMLInputElement).value;
}

function setSource(host: ImportModalHost, event: Event): void {
  host.source = (event.target as HTMLInputElement).value as ImportSource;
}

function setTradingType(host: ImportModalHost, event: Event): void {
  host.tradingType = (event.target as HTMLSelectElement).value;
}

function onImportClick(host: ImportModalHost): void {
  void runImport(host);
}

function constructedUrl(host: ImportModalHost): string {
  return visionDownloadUrl({
    tradingType: host.tradingType || "um",
    dataset: host.futures || "trades",
    granularity: host.granularity || "monthly",
    symbol: host.symbol,
    period: periodFromInput(host.granularity || "monthly", host.periodValue),
  });
}

export const NemoImportModal = define({
  tag: "nemo-import-modal",
  source: "path",
  path: "",
  symbol: "",
  tradingType: "um",
  provider: "Binance",
  futures: "trades",
  granularity: "monthly",
  periodValue: "",
  render: (host: ImportModalHost) => html`
    <dialog>
      <form method="dialog">
        <h2>Import Data</h2>
        <div class="period-toggle">
          Source
          <label>
            <input data-field="source" type="radio" name="source" value="path" checked="${host.source !== "vision"}" onchange="${setSource}" />
            Local CSV
          </label>
          <label>
            <input data-field="source" type="radio" name="source" value="vision" checked="${host.source === "vision"}" onchange="${setSource}" />
            Binance Vision
          </label>
        </div>
        ${host.source === "vision"
          ? html`
              <label>
                Market
                <select data-field="trading-type" onchange="${setTradingType}">
                  ${TRADING_TYPES.map(
                    (item) => html`<option value="${item}" disabled="${item !== "um"}" selected="${(host.tradingType || "um") === item}">
                      ${item}
                    </option>`,
                  )}
                </select>
              </label>
              <label class="wide">
                Symbol
                <input data-field="symbol" value="${host.symbol}" placeholder="BTCUSDC" oninput="${setSymbol}" />
              </label>
              <label class="wide">
                Download URL
                <input data-field="vision-url" value="${constructedUrl(host)}" readonly />
              </label>
            `
          : html`
              <label class="wide">
                CSV path
                <input
                  data-field="path"
                  value="${host.path}"
                  placeholder="E:\\data\\BTCUSDC-trades-2026-08.csv"
                  oninput="${setPath}"
                />
              </label>
            `}
        ${taxonomyFields(host)}
        <div class="actions">
          <button type="submit" value="cancel">Cancel</button>
          <button type="button" data-action="import" disabled="${!canImport(host)}" onclick="${onImportClick}">
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
    input[readonly] {
      color: #9eb3c7;
    }
  `,
});
