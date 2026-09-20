import { CandlestickChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { define, html } from "hybrids";
import { buildChartOption } from "../chart/options.ts";
import { chartStore, subscribe } from "../store.ts";

echarts.use([
  CandlestickChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

type ChartHost = HTMLElement & {
  chart?: echarts.ECharts;
  onResize?: () => void;
  resizeObserver?: ResizeObserver;
};

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
    };
    window.addEventListener("resize", host.onResize);
    if (typeof ResizeObserver !== "undefined") {
      host.resizeObserver = new ResizeObserver(() => host.onResize?.());
      host.resizeObserver.observe(el);
    }
  }
  const cursor = chartStore.playback ? Number(chartStore.playback.cursorNs / 1_000_000n) : null;
  host.chart.setOption(buildChartOption(chartStore.candles, cursor), { replaceMerge: ["series"] });
}

export const NemoChart = define({
  tag: "nemo-chart",
  render: {
    value: () => html`<div class="plot"></div>`.css`
      :host {
        display: block;
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
    `,
    connect: (host: ChartHost, _key, invalidate) => {
      const unsubscribe = subscribe(invalidate);
      return () => {
        unsubscribe();
        window.removeEventListener("resize", host.onResize ?? (() => undefined));
        host.resizeObserver?.disconnect();
        host.chart?.dispose();
        host.chart = undefined;
      };
    },
    observe: (host: ChartHost) => {
      paint(host);
    },
  },
});
