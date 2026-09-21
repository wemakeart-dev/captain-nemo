import type { CandlePoint } from "../store.ts";

export const CANDLE_SERIES_ID = "ohlc";

export const CHART_GRID = {
  left: 56,
  right: 24,
  top: 24,
  bottom: 72,
};

export function cursorOverlayPosition(cursorX: number | null, plotWidth: number) {
  if (cursorX === null || !Number.isFinite(cursorX) || plotWidth <= 0) {
    return { hidden: true, left: 0 };
  }
  const min = CHART_GRID.left;
  const max = plotWidth - CHART_GRID.right;
  if (cursorX < min || cursorX > max) {
    return { hidden: true, left: 0 };
  }
  return { hidden: false, left: cursorX };
}

export function buildChartOption(candles: CandlePoint[]) {
  return {
    animation: false,
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
    },
    grid: { ...CHART_GRID },
    xAxis: {
      type: "time",
      axisLine: { lineStyle: { color: "#6c8196" } },
    },
    yAxis: {
      scale: true,
      axisLine: { lineStyle: { color: "#6c8196" } },
      splitLine: { lineStyle: { color: "#1c2b3a" } },
    },
    dataZoom: [
      { type: "inside", xAxisIndex: 0 },
      { type: "slider", xAxisIndex: 0, height: 28, bottom: 16 },
    ],
    series: [
      {
        id: CANDLE_SERIES_ID,
        type: "candlestick",
        name: "OHLC",
        large: true,
        largeThreshold: 200,
        progressive: 4000,
        progressiveThreshold: 8000,
        data: candles,
        itemStyle: {
          color: "#3dd68c",
          color0: "#f07178",
          borderColor: "#3dd68c",
          borderColor0: "#f07178",
        },
      },
    ],
  };
}
