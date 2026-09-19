import { afterEach, describe, expect, it } from "vitest";
import { chartStore, setStatus } from "../store.ts";
import { NemoStatus } from "./status.ts";

describe("nemo-status", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    setStatus("Disconnected");
  });

  it("renders the chart store status text", async () => {
    expect(NemoStatus).toBeDefined();
    setStatus("Engine v1");
    const el = document.createElement("nemo-status");
    document.body.append(el);
    await Promise.resolve();
    expect(el.shadowRoot?.textContent).toContain("Engine v1");
    expect(chartStore.status).toBe("Engine v1");
  });
});
