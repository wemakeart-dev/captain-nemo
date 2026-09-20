import { describe, expect, it } from "vitest";
import { VISION_BASE_URL, visionArchiveName, visionDownloadUrl, visionRelativeDir } from "./vision.ts";

describe("binance vision urls", () => {
  it("matches official um monthly and daily trades paths", () => {
    const monthly = {
      tradingType: "um",
      dataset: "trades",
      granularity: "monthly",
      symbol: "btcusdc",
      period: "08-2026",
    };
    expect(visionRelativeDir(monthly)).toBe("data/futures/um/monthly/trades/BTCUSDC/");
    expect(visionArchiveName(monthly)).toBe("BTCUSDC-trades-2026-08.zip");
    expect(visionDownloadUrl(monthly)).toBe(
      `${VISION_BASE_URL}data/futures/um/monthly/trades/BTCUSDC/BTCUSDC-trades-2026-08.zip`,
    );

    const daily = {
      tradingType: "um",
      dataset: "trades",
      granularity: "daily",
      symbol: "BTCUSDC",
      period: "01-08-2026",
    };
    expect(visionDownloadUrl(daily)).toBe(
      `${VISION_BASE_URL}data/futures/um/daily/trades/BTCUSDC/BTCUSDC-trades-2026-08-01.zip`,
    );
  });

  it("matches the README spot kline example and futures kline folders", () => {
    expect(
      visionDownloadUrl({
        tradingType: "spot",
        dataset: "klines",
        granularity: "monthly",
        symbol: "ADABKRW",
        period: "2020-08",
        interval: "1h",
      }),
    ).toBe(`${VISION_BASE_URL}data/spot/monthly/klines/ADABKRW/1h/ADABKRW-1h-2020-08.zip`);
    expect(
      visionRelativeDir({
        tradingType: "cm",
        dataset: "premiumIndexKlines",
        granularity: "daily",
        symbol: "BTCUSD_PERP",
        period: "2021-01-01",
        interval: "1m",
      }),
    ).toBe("data/futures/cm/daily/premiumIndexKlines/BTCUSD_PERP/1m/");
  });

  it("returns an empty string until symbol and period are complete", () => {
    expect(
      visionDownloadUrl({
        tradingType: "um",
        dataset: "trades",
        granularity: "monthly",
        symbol: "",
        period: "08-2026",
      }),
    ).toBe("");
  });
});
