import { define, html } from "hybrids";
import "./chart.ts";
import "./file-manager.ts";

export const NemoWorkspace = define({
  tag: "nemo-workspace",
  render: () => html`
    <nemo-file-manager></nemo-file-manager>
    <nemo-chart></nemo-chart>
  `.css`
    :host {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      min-width: 0;
      min-height: 0;
      height: 100%;
      overflow: hidden;
    }
    nemo-file-manager,
    nemo-chart {
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
  `,
});
