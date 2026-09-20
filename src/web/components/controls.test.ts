import { afterEach, describe, expect, it } from "vitest";
import { setConnected, setSelectedFileId, setStatus } from "../store.ts";
import { NemoControls } from "./controls.ts";

describe("nemo-controls", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    setConnected(false);
    setSelectedFileId("");
    setStatus("Disconnected");
  });

  it("renders Stop and no longer renders Load chart", async () => {
    expect(NemoControls).toBeDefined();
    const el = document.createElement("nemo-controls");
    document.body.append(el);
    await Promise.resolve();
    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("Stop");
    expect(text).not.toContain("Load chart");
    expect(el.shadowRoot?.querySelector("[data-action=stop]")).toBeTruthy();
    expect(el.shadowRoot?.querySelector("[data-action=load]")).toBeNull();
  });
});
