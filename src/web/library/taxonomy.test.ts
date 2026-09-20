import { describe, expect, it } from "vitest";
import {
  dateToDisplay,
  FUTURES_DATASETS,
  importReady,
  monthToDisplay,
  periodFromInput,
  visionImportReady,
} from "./taxonomy.ts";

describe("import taxonomy", () => {
  it("formats month and date inputs as MM-YYYY and DD-MM-YYYY", () => {
    expect(monthToDisplay("2026-08")).toBe("08-2026");
    expect(dateToDisplay("2026-08-01")).toBe("01-08-2026");
    expect(periodFromInput("monthly", "2026-08")).toBe("08-2026");
    expect(periodFromInput("daily", "2026-08-01")).toBe("01-08-2026");
  });

  it("disables import without a path and requires trades plus a complete period", () => {
    expect(
      importReady({
        path: "",
        provider: "Binance",
        dataset: "trades",
        granularity: "monthly",
        period: "08-2026",
      }),
    ).toBe(false);
    expect(
      importReady({
        path: "E:/data/file.csv",
        provider: "Binance",
        dataset: "klines",
        granularity: "monthly",
        period: "08-2026",
      }),
    ).toBe(false);
    expect(
      importReady({
        path: "E:/data/file.csv",
        provider: "Binance",
        dataset: "trades",
        granularity: "monthly",
        period: "",
      }),
    ).toBe(false);
    expect(
      importReady({
        path: "E:/data/file.csv",
        provider: "Binance",
        dataset: "trades",
        granularity: "daily",
        period: "01-08-2026",
      }),
    ).toBe(true);
    expect(FUTURES_DATASETS.filter((item) => item !== "trades")).not.toContain("trades");
    expect(FUTURES_DATASETS).toContain("trades");
  });

  it("requires symbol, um trades, and a complete period for Vision import", () => {
    expect(
      visionImportReady({
        path: "",
        provider: "Binance",
        dataset: "trades",
        granularity: "monthly",
        period: "08-2026",
        symbol: "",
        tradingType: "um",
      }),
    ).toBe(false);
    expect(
      visionImportReady({
        path: "",
        provider: "Binance",
        dataset: "trades",
        granularity: "monthly",
        period: "08-2026",
        symbol: "BTCUSDC",
        tradingType: "spot",
      }),
    ).toBe(false);
    expect(
      visionImportReady({
        path: "",
        provider: "Binance",
        dataset: "klines",
        granularity: "monthly",
        period: "08-2026",
        symbol: "BTCUSDC",
        tradingType: "um",
      }),
    ).toBe(false);
    expect(
      visionImportReady({
        path: "",
        provider: "Binance",
        dataset: "trades",
        granularity: "monthly",
        period: "08-2026",
        symbol: "BTCUSDC",
        tradingType: "um",
      }),
    ).toBe(true);
  });
});
