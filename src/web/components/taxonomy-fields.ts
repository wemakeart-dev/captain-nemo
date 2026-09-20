import { html } from "hybrids";
import { FUTURES_DATASETS } from "../library/taxonomy.ts";

export type TaxonomyHost = {
  provider: string;
  futures: string;
  granularity: string;
  periodValue: string;
};

export const fieldCss = `
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
  .period-toggle {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.85rem;
    color: #e8eef5;
  }
  .period-toggle label {
    flex-direction: row;
    align-items: center;
    gap: 0.35rem;
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.85rem;
    color: #e8eef5;
  }
`;

function setProvider(host: TaxonomyHost, event: Event): void {
  host.provider = (event.target as HTMLSelectElement).value;
}

function setFutures(host: TaxonomyHost, event: Event): void {
  host.futures = (event.target as HTMLSelectElement).value;
}

function setGranularity(host: TaxonomyHost, event: Event): void {
  host.granularity = (event.target as HTMLInputElement).value;
  host.periodValue = "";
}

function setPeriod(host: TaxonomyHost, event: Event): void {
  host.periodValue = (event.target as HTMLInputElement).value;
}

export function taxonomyFields(host: TaxonomyHost) {
  return html`
    <label>
      Provider
      <select data-field="provider" onchange="${setProvider}">
        <option value="Binance" selected="${host.provider === "Binance"}">Binance</option>
      </select>
    </label>
    <label>
      Futures
      <select data-field="dataset" onchange="${setFutures}">
        ${FUTURES_DATASETS.map(
          (dataset) => html`<option
            value="${dataset}"
            disabled="${dataset !== "trades"}"
            selected="${host.futures === dataset}"
          >
            ${dataset}
          </option>`,
        )}
      </select>
    </label>
    <div class="period-toggle">
      Time period
      <label>
        <input data-field="granularity" type="radio" name="granularity" value="monthly" checked="${host.granularity === "monthly"}" onchange="${setGranularity}" />
        Monthly
      </label>
      <label>
        <input data-field="granularity" type="radio" name="granularity" value="daily" checked="${host.granularity === "daily"}" onchange="${setGranularity}" />
        Daily
      </label>
    </div>
    ${host.granularity === "daily"
      ? html`<label>
          Date
          <input data-field="period" type="date" value="${host.periodValue}" oninput="${setPeriod}" />
        </label>`
      : html`<label>
          Month
          <input data-field="period" type="month" value="${host.periodValue}" oninput="${setPeriod}" />
        </label>`}
  `;
}
