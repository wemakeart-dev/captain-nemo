import { describe, expect, it } from "vitest";
import { buildChartOption, CANDLE_SERIES_ID, CHART_GRID, cursorOverlayPosition } from "./options.ts";
import { candlesToSeries, type CandlePoint } from "../store.ts";

describe("chart options", () => {
  it("builds a large candlestick series from aggregated bars", () => {
    const candles: CandlePoint[] = [
      [1785542400000, 62806.8, 62808.2, 62800.0, 62810.0],
      [1785542460000, 62808.2, 62811.0, 62804.2, 62812.8],
    ];
    const option = buildChartOption(candlesToSeries(candles));
    expect(option.series).toHaveLength(1);
    expect(option.series[0].id).toBe(CANDLE_SERIES_ID);
    expect(option.series[0].type).toBe("candlestick");
    expect(option.series[0].large).toBe(true);
    expect(option.series[0].progressive).toBe(4000);
    expect(option.series[0].data).toHaveLength(2);
    expect(option.series[0]).not.toHaveProperty("markLine");
    expect(option.grid).toEqual(CHART_GRID);
  });

  it("hides the overlay cursor when it is outside the plot grid", () => {
    expect(cursorOverlayPosition(null, 800)).toEqual({ hidden: true, left: 0 });
    expect(cursorOverlayPosition(Number.NaN, 800)).toEqual({ hidden: true, left: 0 });
    expect(cursorOverlayPosition(CHART_GRID.left - 1, 800)).toEqual({ hidden: true, left: 0 });
    expect(cursorOverlayPosition(800 - CHART_GRID.right + 1, 800)).toEqual({ hidden: true, left: 0 });
    expect(cursorOverlayPosition(400, 800)).toEqual({ hidden: false, left: 400 });
  });
});
