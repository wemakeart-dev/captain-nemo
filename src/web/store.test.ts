import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { applyFrameBuffer, chartStore, setStatus } from "./store.ts";

const golden = resolve(dirname(fileURLToPath(import.meta.url)), "../proto/testdata/golden_bar_batch.bin");

describe("chart store frames", () => {
  afterEach(() => {
    chartStore.candles = [];
    chartStore.playback = null;
    chartStore.instrumentId = "";
    setStatus("Disconnected");
  });

  it("applies a golden bar batch snapshot to candles", () => {
    const bytes = readFileSync(golden);
    applyFrameBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(chartStore.candles).toHaveLength(1);
    expect(chartStore.candles[0]?.[1]).toBe(62806.8);
    expect(chartStore.candles[0]?.[2]).toBe(62808.2);
    expect(chartStore.instrumentId).toBe("BTCUSDC-PERP.BINANCE");
  });
});
