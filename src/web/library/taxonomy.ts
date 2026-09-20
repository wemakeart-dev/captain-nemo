export const FUTURES_DATASETS = [
  "aggTrades",
  "bookDepth",
  "bookTicker",
  "indexPriceKlines",
  "klines",
  "markPriceKlines",
  "metrics",
  "premiumIndexKlines",
  "trades",
] as const;

export type Granularity = "daily" | "monthly";

export type ImportSource = "path" | "vision";

export type TaxonomyDraft = {
  path: string;
  provider: string;
  dataset: string;
  granularity: string;
  period: string;
  source?: ImportSource;
  symbol?: string;
  tradingType?: string;
};

export function monthToDisplay(isoMonth: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(isoMonth.trim());
  if (!match) {
    return "";
  }
  return `${match[2]}-${match[1]}`;
}

export function dateToDisplay(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) {
    return "";
  }
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function displayToMonth(period: string): string {
  const match = /^(\d{2})-(\d{4})$/.exec(period.trim());
  if (!match) {
    return "";
  }
  return `${match[2]}-${match[1]}`;
}

export function displayToDate(period: string): string {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(period.trim());
  if (!match) {
    return "";
  }
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function periodFromInput(granularity: string, isoValue: string): string {
  if (granularity === "monthly") {
    return monthToDisplay(isoValue);
  }
  if (granularity === "daily") {
    return dateToDisplay(isoValue);
  }
  return "";
}

export function inputFromPeriod(granularity: string, period: string): string {
  if (granularity === "monthly") {
    return displayToMonth(period);
  }
  if (granularity === "daily") {
    return displayToDate(period);
  }
  return "";
}

export function importReady(draft: TaxonomyDraft): boolean {
  if (!draft.path.trim()) {
    return false;
  }
  return taxonomyReady(draft);
}

export function visionImportReady(draft: TaxonomyDraft): boolean {
  if (!(draft.symbol ?? "").trim()) {
    return false;
  }
  if ((draft.tradingType || "um") !== "um") {
    return false;
  }
  return taxonomyReady(draft);
}

function taxonomyReady(draft: TaxonomyDraft): boolean {
  if (draft.provider !== "Binance") {
    return false;
  }
  if (draft.dataset !== "trades") {
    return false;
  }
  if (draft.granularity === "monthly") {
    return /^\d{2}-\d{4}$/.test(draft.period);
  }
  if (draft.granularity === "daily") {
    return /^\d{2}-\d{2}-\d{4}$/.test(draft.period);
  }
  return false;
}
