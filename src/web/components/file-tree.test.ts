import { afterEach, describe, expect, it } from "vitest";
import type { FileEntry } from "../../worker/api.ts";
import { chartStore, setActiveFileId, setFiles, setSelectedFileId, setStatus } from "../store.ts";
import { NemoFileTree, toggleCollapsedIds } from "./file-tree.ts";

const sample: FileEntry = {
  fileId: "file-1",
  provider: "Binance",
  dataset: "trades",
  granularity: "daily",
  period: "01-08-2026",
  periodKey: "2026-08-01",
  fileName: "BTCUSDC-trades-2026-08-01.csv",
  path: "E:/data/BTCUSDC-trades-2026-08-01.csv",
  instrumentId: "BTCUSDC-PERP.BINANCE",
  symbol: "BTCUSDC",
  startNs: "1",
  endNs: "2",
  tradeCount: "25",
};

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("toggleCollapsedIds", () => {
  it("adds then removes a folder id", () => {
    const collapsed = toggleCollapsedIds("", "folder:Binance");
    expect(collapsed).toBe("folder:Binance");
    expect(toggleCollapsedIds(collapsed, "folder:Binance")).toBe("");
  });
});

describe("nemo-file-tree folders", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    setFiles([]);
    setActiveFileId("");
    setSelectedFileId("");
    setStatus("Disconnected");
  });

  it("collapses a directory immediately and expands it again on the next click", async () => {
    expect(NemoFileTree).toBeDefined();
    setFiles([sample]);
    const el = document.createElement("nemo-file-tree") as HTMLElement & { collapsedIds: string };
    document.body.append(el);
    await flush();
    const folder = el.shadowRoot?.querySelector("[data-folder-id='folder:Binance']") as HTMLButtonElement;
    expect(folder).toBeTruthy();
    expect(el.shadowRoot?.querySelector("li.folder.collapsed")).toBeNull();
    expect(folder.getAttribute("aria-expanded")).toBe("true");

    folder.click();
    await flush();
    expect(el.collapsedIds).toBe("folder:Binance");
    const collapsed = el.shadowRoot?.querySelector("li.folder.collapsed");
    expect(collapsed).toBeTruthy();
    expect(el.shadowRoot?.querySelector("[data-folder-id='folder:Binance']")?.getAttribute("aria-expanded")).toBe(
      "false",
    );

    const again = el.shadowRoot?.querySelector("[data-folder-id='folder:Binance']") as HTMLButtonElement;
    again.click();
    await flush();
    expect(el.collapsedIds).toBe("");
    expect(el.shadowRoot?.querySelector("li.folder.collapsed")).toBeNull();
    expect(el.shadowRoot?.querySelector("[data-folder-id='folder:Binance']")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("activates a file name and does not render per-file action icons", async () => {
    setFiles([sample]);
    const el = document.createElement("nemo-file-tree");
    document.body.append(el);
    await flush();
    expect(el.shadowRoot?.querySelector("[data-action]")).toBeNull();
    expect(el.shadowRoot?.querySelector("svg")).toBeNull();
    const name = el.shadowRoot?.querySelector("button.name") as HTMLButtonElement;
    expect(name.textContent).toContain("BTCUSDC-trades-2026-08-01.csv");
    expect(el.shadowRoot?.querySelector("li.file.active")).toBeNull();
    name.click();
    await flush();
    expect(chartStore.activeFileId).toBe("file-1");
    expect(el.shadowRoot?.querySelector("li.file.active")).toBeTruthy();
  });

  it("emits nemo-period from a period folder in pick mode", async () => {
    setFiles([sample]);
    const el = document.createElement("nemo-file-tree") as HTMLElement & { mode: string };
    el.mode = "pick";
    document.body.append(el);
    await flush();
    let detail: unknown;
    el.addEventListener("nemo-period", (event) => {
      detail = (event as CustomEvent).detail;
    });
    const period = el.shadowRoot?.querySelector("[data-period='01-08-2026']") as HTMLButtonElement;
    period.click();
    expect(detail).toEqual({
      provider: "Binance",
      dataset: "trades",
      granularity: "daily",
      period: "01-08-2026",
    });
  });
});
