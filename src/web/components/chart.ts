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
};

function paint(host: ChartHost) {
  const el = host.shadowRoot?.querySelector(".plot") as HTMLDivElement | null;
  if (!el) {
    return;
  }
  if (!host.chart) {
    host.chart = echarts.init(el, undefined, { renderer: "canvas" });
    host.onResize = () => host.chart?.resize();
    window.addEventListener("resize", host.onResize);
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
      }
      .plot {
        width: 100%;
        height: 100%;
        min-height: 480px;
      }
    `,
    connect: (host: ChartHost, _key, invalidate) => {
      const unsubscribe = subscribe(invalidate);
      return () => {
        unsubscribe();
        window.removeEventListener("resize", host.onResize ?? (() => undefined));
        host.chart?.dispose();
        host.chart = undefined;
      };
    },
    observe: (host: ChartHost) => {
      paint(host);
    },
  },
});
