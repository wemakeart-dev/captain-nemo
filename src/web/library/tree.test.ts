import { describe, expect, it } from "vitest";
import type { FileEntry } from "../../worker/api.ts";
import { buildFileTree } from "./tree.ts";

function file(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    fileId: "a",
    provider: "Binance",
    dataset: "trades",
    granularity: "daily",
    period: "02-08-2026",
    periodKey: "2026-08-02",
    fileName: "BTCUSDC-trades-2026-08-02.csv",
    path: "E:/data/BTCUSDC-trades-2026-08-02.csv",
    instrumentId: "BTCUSDC-PERP.BINANCE",
    symbol: "BTCUSDC",
    startNs: "2",
    endNs: "3",
    tradeCount: "3",
    ...overrides,
  };
}

describe("buildFileTree", () => {
  it("nests provider / dataset / granularity / period / file and sorts by period_key", () => {
    const tree = buildFileTree([
      file(),
      file({
        fileId: "b",
        period: "01-08-2026",
        periodKey: "2026-08-01",
        fileName: "BTCUSDC-trades-2026-08-01.csv",
        path: "E:/data/BTCUSDC-trades-2026-08-01.csv",
        startNs: "1",
      }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.label).toBe("Binance");
    const dataset = tree[0]?.children[0];
    expect(dataset?.kind).toBe("folder");
    expect(dataset?.label).toBe("trades");
    const granularity = dataset && dataset.kind === "folder" ? dataset.children[0] : undefined;
    expect(granularity?.label).toBe("daily");
    const periods = granularity && granularity.kind === "folder" ? granularity.children : [];
    expect(periods.map((node) => node.label)).toEqual(["01-08-2026", "02-08-2026"]);
    const first = periods[0];
    expect(first?.kind).toBe("folder");
    if (first?.kind === "folder") {
      expect(first.taxonomy?.period).toBe("01-08-2026");
      expect(first.children[0]?.kind).toBe("file");
      expect(first.children[0]?.label).toBe("BTCUSDC-trades-2026-08-01.csv");
    }
  });
});
