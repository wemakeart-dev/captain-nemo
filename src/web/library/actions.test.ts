import { describe, expect, it } from "vitest";
import type { FileEntry } from "../../worker/api.ts";
import { actionEnabled, fileForAction } from "./actions.ts";

const sample: FileEntry = {
  fileId: "file-1",
  provider: "Binance",
  dataset: "trades",
  granularity: "daily",
  period: "01-08-2026",
  periodKey: "2026-08-01",
  fileName: "BTCUSDC-trades-2026-08-01.csv",
  path: "E:/data/file.csv",
  instrumentId: "BTCUSDC-PERP.BINANCE",
  symbol: "BTCUSDC",
  startNs: "1",
  endNs: "2",
  tradeCount: "25",
};

describe("file manager actions", () => {
  it("keeps global actions disabled until a file name is active", () => {
    expect(actionEnabled("")).toBe(false);
    expect(fileForAction([sample], "")).toBeUndefined();
    expect(actionEnabled("file-1")).toBe(true);
    expect(fileForAction([sample], "file-1")).toEqual(sample);
    expect(fileForAction([sample], "missing")).toBeUndefined();
  });
});
