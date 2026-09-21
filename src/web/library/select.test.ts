import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../../worker/api.ts";
import { chartStore, hasSelectedFile, setActiveFileId, setFiles, setSelectedFileId, setStatus } from "../store.ts";
import { clearSelectionIfRemoved, reloadSelectedFile, selectFile } from "./select.ts";

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
  startNs: "1785542400000000000",
  endNs: "1785543600000000000",
  tradeCount: "25",
};

describe("selectFile", () => {
  afterEach(() => {
    chartStore.instrumentId = "";
    chartStore.barStep = "1m";
    setFiles([]);
    setActiveFileId("");
    setSelectedFileId("");
    setStatus("Disconnected");
  });

  it("loads the chart for the file range and is what enables Play", async () => {
    chartStore.files = [sample];
    const queryBars = vi.fn().mockResolvedValue({ barCount: 12 });
    const resetPlayback = vi.fn().mockResolvedValue({ playing: false, speed: 1 });
    expect(hasSelectedFile()).toBe(false);
    await selectFile(sample, { queryBars, resetPlayback }, "1m");
    expect(chartStore.selectedFileId).toBe("file-1");
    expect(chartStore.activeFileId).toBe("file-1");
    expect(hasSelectedFile()).toBe(true);
    expect(chartStore.instrumentId).toBe("BTCUSDC-PERP.BINANCE");
    expect(queryBars).toHaveBeenCalledWith(
      "BTCUSDC-PERP.BINANCE",
      "1m",
      "1785542400000000000",
      "1785543600000000000",
    );
    expect(resetPlayback).toHaveBeenCalled();
  });

  it("reloads the selected file at a new bar step", async () => {
    chartStore.files = [sample];
    chartStore.selectedFileId = sample.fileId;
    const queryBars = vi.fn().mockResolvedValue({ barCount: 9 });
    const resetPlayback = vi.fn().mockResolvedValue({ playing: false, speed: 1 });
    await reloadSelectedFile({ queryBars, resetPlayback }, "5m");
    expect(queryBars).toHaveBeenCalledWith(
      "BTCUSDC-PERP.BINANCE",
      "5m",
      "1785542400000000000",
      "1785543600000000000",
    );
    expect(resetPlayback).toHaveBeenCalled();
    expect(chartStore.status).toBe("Loaded 9 bars");
  });

  it("does not apply a superseded bar-step query", async () => {
    chartStore.files = [sample];
    let finishFirst: (count: number) => void = () => undefined;
    const queryBars = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ barCount: number }>((resolve) => {
            finishFirst = (barCount) => resolve({ barCount });
          }),
      )
      .mockResolvedValueOnce({ barCount: 4 });
    const resetPlayback = vi.fn().mockResolvedValue({ playing: false, speed: 1 });
    const first = selectFile(sample, { queryBars, resetPlayback }, "1m");
    const second = selectFile(sample, { queryBars, resetPlayback }, "5m");
    await second;
    finishFirst(12);
    await first;
    expect(chartStore.status).toBe("Loaded 4 bars");
  });

  it("clears active and chart selection when that file is removed", () => {
    chartStore.files = [sample];
    chartStore.activeFileId = sample.fileId;
    chartStore.selectedFileId = sample.fileId;
    chartStore.candles = [[1, 2, 3, 4, 5]];
    clearSelectionIfRemoved(sample.fileId);
    expect(chartStore.activeFileId).toBe("");
    expect(chartStore.selectedFileId).toBe("");
    expect(chartStore.candles).toEqual([]);
  });
});
