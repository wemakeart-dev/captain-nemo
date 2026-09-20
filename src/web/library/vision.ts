export const VISION_BASE_URL = "https://data.binance.vision/";
export const TRADING_TYPES = ["spot", "um", "cm"] as const;
export const TICK_DATASETS = ["trades", "aggTrades"] as const;
export const KLINE_DATASETS = ["klines", "indexPriceKlines", "markPriceKlines", "premiumIndexKlines"] as const;

export type VisionSpecInput = {
  tradingType: string;
  dataset: string;
  granularity: string;
  symbol: string;
  period: string;
  interval?: string;
};

export function periodIso(granularity: string, period: string): string {
  const text = period.trim();
  if (granularity === "daily") {
    const display = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
    if (display) {
      return `${display[3]}-${display[2]}-${display[1]}`;
    }
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (iso) {
      return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
    return "";
  }
  const display = /^(\d{2})-(\d{4})$/.exec(text);
  if (display) {
    return `${display[2]}-${display[1]}`;
  }
  const iso = /^(\d{4})-(\d{2})$/.exec(text);
  if (iso) {
    return `${iso[1]}-${iso[2]}`;
  }
  return "";
}

export function visionRelativeDir(input: VisionSpecInput): string {
  const trading = input.tradingType.trim().toLowerCase();
  const symbol = input.symbol.trim().toUpperCase();
  const root = trading === "spot" ? "data/spot" : `data/futures/${trading}`;
  let path = `${root}/${input.granularity}/${input.dataset}/${symbol}/`;
  if (input.interval) {
    path += `${input.interval}/`;
  }
  return path;
}

export function visionArchiveName(input: VisionSpecInput): string {
  const symbol = input.symbol.trim().toUpperCase();
  const iso = periodIso(input.granularity, input.period);
  if ((TICK_DATASETS as readonly string[]).includes(input.dataset)) {
    return `${symbol}-${input.dataset}-${iso}.zip`;
  }
  return `${symbol}-${input.interval}-${iso}.zip`;
}

export function visionDownloadUrl(input: VisionSpecInput): string {
  const symbol = input.symbol.trim();
  const iso = periodIso(input.granularity, input.period);
  if (!symbol || !iso || !input.granularity || !input.dataset || !input.tradingType) {
    return "";
  }
  if (!(TICK_DATASETS as readonly string[]).includes(input.dataset) && !input.interval) {
    return "";
  }
  return `${VISION_BASE_URL}${visionRelativeDir(input)}${visionArchiveName(input)}`;
}
