import { define, html } from "hybrids";
import { chartStore, subscribeKeys } from "../store.ts";

export const NemoStatus = define({
  tag: "nemo-status",
  render: {
    value: () => html`
      <p>${chartStore.status}${chartStore.connected ? " · connected" : ""}</p>
    `.css`
      :host { display: block; }
      p {
        margin: 0;
        color: #9eb3c7;
        font-size: 0.85rem;
        letter-spacing: 0.02em;
      }
    `,
    connect: (_host, _key, invalidate) => subscribeKeys(["status", "connected"], invalidate),
  },
});
