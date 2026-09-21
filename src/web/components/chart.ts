import { CandlestickChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { define, html } from "hybrids";
import { buildChartOption, cursorOverlayPosition } from "../chart/options.ts";
import { chartStore, subscribeKeys, type CandlePoint } from "../store.ts";

echarts.use([CandlestickChart, GridComponent, TooltipComponent, DataZoomComponent, CanvasRenderer]);

type ChartHost = HTMLElement & {
  chart?: echarts.ECharts;
  onResize?: () => void;
  onDataZoom?: () => void;
  resizeObserver?: ResizeObserver;
  paintedCandles?: CandlePoint[];
  paintRaf?: number;
};

function cursorMsFromStore(): number | null {
  return chartStore.playback ? Number(chartStore.playback.cursorNs / 1_000_000n) : null;
}

function convertCursorX(chart: echarts.ECharts, cursorMs: number): number | null {
  try {
    const pixel = chart.convertToPixel({ xAxisIndex: 0 }, cursorMs);
    const x = Array.isArray(pixel) ? pixel[0] : pixel;
    return typeof x === "number" ? x : null;
  } catch {
    return null;
  }
}

function placeCursor(host: ChartHost) {
  const line = host.shadowRoot?.querySelector(".playback-cursor") as HTMLDivElement | null;
  if (!line) {
    return;
  }
  const cursorMs = cursorMsFromStore();
  const chart = host.chart;
  if (!chart || cursorMs === null) {
    line.hidden = true;
    return;
  }
  const pos = cursorOverlayPosition(convertCursorX(chart, cursorMs), chart.getWidth());
  line.hidden = pos.hidden;
  if (!pos.hidden) {
    line.style.left = `${pos.left}px`;
  }
}

function paint(host: ChartHost) {
  const el = host.shadowRoot?.querySelector(".plot") as HTMLDivElement | null;
  if (!el || el.clientWidth < 1 || el.clientHeight < 1) {
    return;
  }
  if (!host.chart) {
    host.chart = echarts.init(el, undefined, { renderer: "canvas" });
    host.onResize = () => {
      if (!host.chart) {
        paint(host);
        return;
      }
      host.chart.resize();
      placeCursor(host);
    };
    host.onDataZoom = () => placeCursor(host);
    host.chart.on("datazoom", host.onDataZoom);
    window.addEventListener("resize", host.onResize);
    if (typeof ResizeObserver !== "undefined") {
      host.resizeObserver = new ResizeObserver(() => host.onResize?.());
      host.resizeObserver.observe(el);
    }
  }
  const candles = chartStore.candles;
  if (host.paintedCandles !== candles) {
    host.paintedCandles = candles;
    host.chart.setOption(buildChartOption(candles), { replaceMerge: ["series"] });
  }
  placeCursor(host);
}

export const NemoChart = define({
  tag: "nemo-chart",
  render: {
    value: () =>
      html`
        <div class="plot"></div>
        <div class="playback-cursor" hidden></div>
      `.css`
      :host {
        display: block;
        position: relative;
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
      }
      .plot {
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
      }
      .playback-cursor {
        position: absolute;
        top: 24px;
        bottom: 72px;
        width: 0;
        border-left: 1px dashed #e3c565;
        pointer-events: none;
        z-index: 2;
      }
    `,
    connect: (host: ChartHost, _key, invalidate) => {
      const schedule = () => {
        if (host.paintRaf) {
          return;
        }
        const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: FrameRequestCallback) =>
          setTimeout(() => cb(0), 0);
        host.paintRaf = raf(() => {
          host.paintRaf = 0;
          if (host.chart && host.paintedCandles === chartStore.candles) {
            placeCursor(host);
            return;
          }
          invalidate();
        }) as number;
      };
      const unsubscribe = subscribeKeys(["candles", "playback"], schedule);
      return () => {
        unsubscribe();
        if (host.paintRaf && typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(host.paintRaf);
        }
        host.paintRaf = 0;
        if (host.chart && host.onDataZoom) {
          host.chart.off("datazoom", host.onDataZoom);
        }
        window.removeEventListener("resize", host.onResize ?? (() => undefined));
        host.resizeObserver?.disconnect();
        host.chart?.dispose();
        host.chart = undefined;
        host.paintedCandles = undefined;
      };
    },
    observe: (host: ChartHost) => {
      paint(host);
    },
  },
});
