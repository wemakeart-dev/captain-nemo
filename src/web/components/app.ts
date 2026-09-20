import { define, html } from "hybrids";
import "./controls.ts";
import "./status.ts";
import "./workspace.ts";

export const NemoApp = define({
  tag: "nemo-app",
  render: () => html`
    <header>
      <div>
        <p class="eyebrow">Local research terminal</p>
        <h1>Captain Nemo</h1>
      </div>
      <nemo-status></nemo-status>
    </header>
    <nemo-controls></nemo-controls>
    <nemo-workspace></nemo-workspace>
  `.css`
    :host {
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      grid-template-columns: minmax(0, 1fr);
      gap: 1rem;
      height: 100%;
      max-height: 100%;
      overflow: hidden;
      min-width: 0;
      padding: 1.25rem 1.5rem 1.5rem;
      box-sizing: border-box;
    }
    header,
    nemo-controls,
    nemo-workspace {
      min-width: 0;
    }
    nemo-workspace {
      min-height: 0;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: end;
      gap: 1rem;
    }
    h1 {
      margin: 0;
      font-size: 1.8rem;
      font-weight: 600;
    }
    .eyebrow {
      margin: 0 0 0.2rem;
      color: #e3c565;
      font-size: 0.72rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
  `,
});
