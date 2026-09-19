import { describe, expect, it } from "vitest";
import { buildChartOption } from "./options.ts";
import { candlesToSeries, type CandlePoint } from "../store.ts";

describe("chart options", () => {
  it("builds a large candlestick series from aggregated bars", () => {
    const candles: CandlePoint[] = [
      [1785542400000, 62806.8, 62808.2, 62800.0, 62810.0],
      [1785542460000, 62808.2, 62811.0, 62804.2, 62812.8],
    ];
    const option = buildChartOption(candlesToSeries(candles), 1785542400000);
    expect(option.series[0].type).toBe("candlestick");
    expect(option.series[0].large).toBe(true);
    expect(option.series[0].progressive).toBe(4000);
    expect(option.series[0].data).toHaveLength(2);
    expect(option.series[0].markLine?.data?.[0]).toEqual({ xAxis: 1785542400000 });
  });
});
