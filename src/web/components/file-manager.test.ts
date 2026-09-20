import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileEntry, WorkerApi } from "../../worker/api.ts";
import { setEngineApi } from "../session.ts";
import { chartStore, setActiveFileId, setFileManagerOpen, setFiles, setSelectedFileId, setStatus } from "../store.ts";
import { NemoFileManager } from "./file-manager.ts";

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

function mockEngine(overrides: Partial<WorkerApi> = {}): WorkerApi {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    importCsv: vi.fn(),
    importVision: vi.fn(),
    listCatalog: vi.fn().mockResolvedValue([]),
    listFiles: vi.fn().mockResolvedValue([]),
    removeFile: vi.fn().mockResolvedValue({ fileId: sample.fileId }),
    moveFile: vi.fn(),
    queryBars: vi.fn().mockResolvedValue({ barCount: 12 }),
    play: vi.fn(),
    pause: vi.fn(),
    resetPlayback: vi.fn().mockResolvedValue({ playing: false, speed: 1 }),
    setSpeed: vi.fn(),
    ...overrides,
  } as WorkerApi;
}

function barButtons(el: HTMLElement) {
  const root = el.shadowRoot;
  return {
    select: root?.querySelector("[data-action=select]") as HTMLButtonElement,
    remove: root?.querySelector("[data-action=remove]") as HTMLButtonElement,
    move: root?.querySelector("[data-action=move]") as HTMLButtonElement,
  };
}

describe("nemo-file-manager", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    setEngineApi(null);
    setFiles([]);
    setActiveFileId("");
    setSelectedFileId("");
    setFileManagerOpen(true);
    setStatus("Disconnected");
  });

  it("renders an empty tree and a populated file name", async () => {
    expect(NemoFileManager).toBeDefined();
    const empty = document.createElement("nemo-file-manager");
    document.body.append(empty);
    await flush();
    const emptyTree = empty.shadowRoot?.querySelector("nemo-file-tree");
    expect(emptyTree?.shadowRoot?.textContent).toContain("No files imported");

    setFiles([sample]);
    const populated = document.createElement("nemo-file-manager");
    document.body.append(populated);
    await flush();
    const populatedTree = populated.shadowRoot?.querySelector("nemo-file-tree");
    expect(populatedTree?.shadowRoot?.textContent).toContain("BTCUSDC-trades-2026-08-01.csv");
  });

  it("toggles the collapsed class from fileManagerOpen", async () => {
    const el = document.createElement("nemo-file-manager");
    document.body.append(el);
    await flush();
    expect(el.classList.contains("collapsed")).toBe(false);
    setFileManagerOpen(false);
    await flush();
    expect(el.classList.contains("collapsed")).toBe(true);
    expect(chartStore.fileManagerOpen).toBe(false);
  });

  it("keeps Select Data, Remove, and Move in a bottom bar, disabled until a file name is clicked", async () => {
    setFiles([sample]);
    const el = document.createElement("nemo-file-manager");
    document.body.append(el);
    await flush();
    const tree = el.shadowRoot?.querySelector("nemo-file-tree");
    expect(tree?.shadowRoot?.querySelector("[data-action]")).toBeNull();
    expect(tree?.shadowRoot?.querySelector("svg")).toBeNull();
    expect(el.shadowRoot?.querySelector(".body [data-action=select]")).toBeNull();

    const bar = el.shadowRoot?.querySelector(".bar");
    expect(bar).toBeTruthy();
    const { select, remove, move } = barButtons(el);
    expect(select.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
    expect(move.disabled).toBe(true);
    expect(select.textContent).toContain("Select Data");
    expect(remove.textContent).toContain("Remove");
    expect(move.textContent).toContain("Move");
    expect(select.querySelector("svg")).toBeTruthy();
    expect(remove.querySelector("svg")).toBeTruthy();
    expect(move.querySelector("svg")).toBeTruthy();

    const name = tree?.shadowRoot?.querySelector("button.name") as HTMLButtonElement;
    name.click();
    await flush();
    expect(chartStore.activeFileId).toBe("file-1");
    expect(barButtons(el).select.disabled).toBe(false);
    expect(barButtons(el).remove.disabled).toBe(false);
    expect(barButtons(el).move.disabled).toBe(false);
  });

  it("Select Data loads the active file onto the chart", async () => {
    const queryBars = vi.fn().mockResolvedValue({ barCount: 12 });
    const resetPlayback = vi.fn().mockResolvedValue({ playing: false, speed: 1 });
    setEngineApi(mockEngine({ queryBars, resetPlayback }));
    setFiles([sample]);
    setActiveFileId(sample.fileId);
    const el = document.createElement("nemo-file-manager");
    document.body.append(el);
    await flush();
    barButtons(el).select.click();
    await vi.waitFor(() => {
      expect(chartStore.selectedFileId).toBe(sample.fileId);
    });
    expect(queryBars).toHaveBeenCalledWith(sample.instrumentId, "1m", sample.startNs, sample.endNs);
    expect(resetPlayback).toHaveBeenCalled();
  });

  it("Remove deletes the active file and clears the selection", async () => {
    const removeFile = vi.fn().mockResolvedValue({ fileId: sample.fileId });
    setEngineApi(mockEngine({ removeFile }));
    setFiles([sample]);
    setActiveFileId(sample.fileId);
    setSelectedFileId(sample.fileId);
    const el = document.createElement("nemo-file-manager");
    document.body.append(el);
    await flush();
    barButtons(el).remove.click();
    await vi.waitFor(() => {
      expect(chartStore.activeFileId).toBe("");
    });
    expect(removeFile).toHaveBeenCalledWith(sample.fileId);
    expect(chartStore.selectedFileId).toBe("");
    expect(barButtons(el).select.disabled).toBe(true);
  });

  it("Move targets the active file", async () => {
    setFiles([sample]);
    setActiveFileId(sample.fileId);
    const el = document.createElement("nemo-file-manager") as HTMLElement & { movingFileId: string };
    document.body.append(el);
    await flush();
    barButtons(el).move.click();
    await flush();
    expect(el.movingFileId).toBe(sample.fileId);
  });
});
