import type { CandlePoint } from "./store.ts";

export function buildChartOption(candles: CandlePoint[], cursorMs: number | null) {
  return {
    animation: false,
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
    },
    grid: {
      left: 56,
      right: 24,
      top: 24,
      bottom: 72,
    },
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
        markLine:
          cursorMs === null
            ? undefined
            : {
                symbol: "none",
                lineStyle: { color: "#e3c565", type: "dashed" },
                data: [{ xAxis: cursorMs }],
              },
      },
    ],
  };
}
