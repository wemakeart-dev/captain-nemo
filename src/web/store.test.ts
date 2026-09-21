import { create, toBinary } from "@bufbuild/protobuf";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PlaybackStateSchema, SocketFrameSchema } from "@proto/captain_nemo/v1/wire_pb.ts";
import { applyFrameBuffer, applyFrameBuffers, applyPlaybackAck, chartStore, mergeCandleDeltas, resolvePlayArgs, setFiles, setStatus, subscribe, type CandlePoint } from "./store.ts";
import type { PlaybackState } from "@proto/captain_nemo/v1/wire_pb.ts";

const golden = resolve(dirname(fileURLToPath(import.meta.url)), "../proto/testdata/golden_bar_batch.bin");

function frameBuffer(frame: ReturnType<typeof create<typeof SocketFrameSchema>>): ArrayBuffer {
  const bytes = toBinary(SocketFrameSchema, frame);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function playbackState(fields: Partial<PlaybackState>): PlaybackState {
  return create(PlaybackStateSchema, fields);
}

describe("chart store frames", () => {
  afterEach(() => {
    chartStore.candles = [];
    chartStore.trades = [];
    chartStore.playback = null;
    chartStore.instrumentId = "";
    chartStore.speed = 1;
    chartStore.files = [];
    chartStore.selectedFileId = "";
    chartStore.activeFileId = "";
    chartStore.playbackBusy = false;
    chartStore.barStep = "1m";
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

  it("applies playback state cursor, playing, and speed", () => {
    applyFrameBuffer(
      frameBuffer(
        create(SocketFrameSchema, {
          kind: {
            case: "playback",
            value: {
              instrumentId: "BTCUSDC-PERP.BINANCE",
              cursorNs: 1785542460000000000n,
              speed: 60,
              playing: true,
              startNs: 1785542400000000000n,
              endNs: 1785543600000000000n,
            },
          },
        }),
      ),
    );
    expect(chartStore.playback?.playing).toBe(true);
    expect(chartStore.playback?.cursorNs).toBe(1785542460000000000n);
    expect(chartStore.speed).toBe(60);
  });

  it("keeps the last 200 trades from a trade batch", () => {
    applyFrameBuffer(
      frameBuffer(
        create(SocketFrameSchema, {
          kind: {
            case: "trades",
            value: {
              instrumentId: "BTCUSDC-PERP.BINANCE",
              trades: Array.from({ length: 205 }, (_, index) => ({
                id: BigInt(index + 1),
                price: "1",
                qty: "1",
                quoteQty: "1",
                tsEventNs: 1785542400000000000n + BigInt(index),
                isBuyerMaker: false,
              })),
            },
          },
        }),
      ),
    );
    expect(chartStore.trades).toHaveLength(200);
    expect(chartStore.trades[0]?.id).toBe(6n);
    expect(chartStore.trades[199]?.id).toBe(205n);
  });

  it("applies a playback ack without waiting for a playback frame", () => {
    applyPlaybackAck({ playing: true, speed: 5 });
    expect(chartStore.playback?.playing).toBe(true);
    expect(chartStore.speed).toBe(5);
  });

  it("notifies once for a batch of bars and playback frames", () => {
    let calls = 0;
    const unsubscribe = subscribe(() => {
      calls += 1;
    });
    applyFrameBuffers([
      frameBuffer(
        create(SocketFrameSchema, {
          kind: {
            case: "bars",
            value: {
              instrumentId: "BTCUSDC-PERP.BINANCE",
              barStep: "1m",
              snapshot: true,
              bars: [
                {
                  tsEventNs: 1785542400000000000n,
                  open: "1",
                  high: "2",
                  low: "0",
                  close: "1.5",
                  volume: "1",
                  tradeCount: 1,
                },
              ],
            },
          },
        }),
      ),
      frameBuffer(
        create(SocketFrameSchema, {
          kind: {
            case: "playback",
            value: {
              instrumentId: "BTCUSDC-PERP.BINANCE",
              cursorNs: 1785542400000000000n,
              speed: 1,
              playing: true,
              startNs: 1785542400000000000n,
              endNs: 1785543600000000000n,
            },
          },
        }),
      ),
    ]);
    unsubscribe();
    expect(calls).toBe(1);
    expect(chartStore.candles).toHaveLength(1);
    expect(chartStore.playback?.playing).toBe(true);
  });
});

describe("candle delta merge", () => {
  const LARGE = 44_633;

  function candles(count: number, start = 0): CandlePoint[] {
    return Array.from({ length: count }, (_, index) => {
      const ts = (start + index) * 60_000;
      return [ts, 1, 1, 1, 1] as CandlePoint;
    });
  }

  it("appends ordered deltas after a 44633-bar snapshot without replacing the prefix", () => {
    const snapshot = candles(LARGE);
    const extra = candles(256, LARGE);
    const merged = mergeCandleDeltas(snapshot, extra);
    expect(merged.changed).toBe(true);
    expect(merged.candles).toHaveLength(LARGE + 256);
    expect(merged.candles[0]).toBe(snapshot[0]);
    expect(merged.candles[LARGE - 1]).toBe(snapshot[LARGE - 1]);
    expect(merged.candles[LARGE]?.[0]).toBe(LARGE * 60_000);
  });

  it("skips redundant deltas whose timestamps are already in the snapshot", () => {
    const snapshot = candles(LARGE);
    const redundant = snapshot.slice(-256);
    const merged = mergeCandleDeltas(snapshot, redundant);
    expect(merged.changed).toBe(false);
    expect(merged.candles).toBe(snapshot);
  });

  it("does not replace candles when a non-snapshot frame repeats loaded timestamps", () => {
    applyFrameBuffer(
      frameBuffer(
        create(SocketFrameSchema, {
          kind: {
            case: "bars",
            value: {
              instrumentId: "BTCUSDC-PERP.BINANCE",
              barStep: "1m",
              snapshot: true,
              bars: [
                {
                  tsEventNs: 1785542400000000000n,
                  open: "1",
                  high: "2",
                  low: "0",
                  close: "1.5",
                  volume: "1",
                  tradeCount: 1,
                },
                {
                  tsEventNs: 1785542460000000000n,
                  open: "1.5",
                  high: "2.5",
                  low: "1",
                  close: "2",
                  volume: "1",
                  tradeCount: 1,
                },
              ],
            },
          },
        }),
      ),
    );
    const before = chartStore.candles;
    applyFrameBuffer(
      frameBuffer(
        create(SocketFrameSchema, {
          kind: {
            case: "bars",
            value: {
              instrumentId: "BTCUSDC-PERP.BINANCE",
              barStep: "1m",
              snapshot: false,
              bars: [
                {
                  tsEventNs: 1785542400000000000n,
                  open: "1",
                  high: "2",
                  low: "0",
                  close: "1.5",
                  volume: "1",
                  tradeCount: 1,
                },
              ],
            },
          },
        }),
      ),
    );
    expect(chartStore.candles).toBe(before);
  });

  it("ignores a bar snapshot whose step no longer matches the dropdown", () => {
    chartStore.candles = [];
    chartStore.barStep = "5m";
    applyFrameBuffer(
      frameBuffer(
        create(SocketFrameSchema, {
          kind: {
            case: "bars",
            value: {
              instrumentId: "BTCUSDC-PERP.BINANCE",
              barStep: "1m",
              snapshot: true,
              bars: [
                {
                  tsEventNs: 1785542400000000000n,
                  open: "1",
                  high: "2",
                  low: "0",
                  close: "1.5",
                  volume: "1",
                  tradeCount: 1,
                },
              ],
            },
          },
        }),
      ),
    );
    expect(chartStore.candles).toEqual([]);
    expect(chartStore.barStep).toBe("5m");
  });
});

describe("resolvePlayArgs", () => {
  afterEach(() => {
    chartStore.playback = null;
    chartStore.instrumentId = "";
    chartStore.speed = 1;
    chartStore.files = [];
    chartStore.selectedFileId = "";
    chartStore.activeFileId = "";
  });

  it("resumes from the paused cursor", () => {
    chartStore.instrumentId = "BTCUSDC-PERP.BINANCE";
    chartStore.speed = 60;
    chartStore.selectedFileId = "file-1";
    chartStore.files = [
      {
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
        startNs: "1785542400000000000",
        endNs: "1785543600000000000",
        tradeCount: "25",
      },
    ];
    chartStore.playback = playbackState({
      instrumentId: "BTCUSDC-PERP.BINANCE",
      cursorNs: 1785542460000000000n,
      speed: 60,
      playing: false,
      startNs: 1785542400000000000n,
      endNs: 1785543600000000000n,
    });
    expect(resolvePlayArgs(chartStore)).toEqual({
      speed: 60,
      startNs: "1785542460000000000",
      endNs: "1785543600000000000",
    });
  });

  it("restarts from the beginning at end of range or when idle", () => {
    chartStore.instrumentId = "BTCUSDC-PERP.BINANCE";
    chartStore.speed = 60;
    expect(resolvePlayArgs(chartStore)).toEqual({ speed: 60, startNs: "0", endNs: "0" });
    chartStore.playback = playbackState({
      instrumentId: "BTCUSDC-PERP.BINANCE",
      cursorNs: 1785543600000000000n,
      speed: 60,
      playing: false,
      startNs: 1785542400000000000n,
      endNs: 1785543600000000000n,
    });
    expect(resolvePlayArgs(chartStore)).toEqual({ speed: 60, startNs: "0", endNs: "0" });
  });

  it("starts from the selected file after Stop/reset instead of a paused cursor", () => {
    chartStore.instrumentId = "BTCUSDC-PERP.BINANCE";
    chartStore.speed = 60;
    chartStore.selectedFileId = "file-1";
    chartStore.files = [
      {
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
        startNs: "1785542400000000000",
        endNs: "1785543600000000000",
        tradeCount: "25",
      },
    ];
    chartStore.playback = playbackState({
      instrumentId: "BTCUSDC-PERP.BINANCE",
      cursorNs: 1785542400000000000n,
      speed: 60,
      playing: false,
      startNs: 1785542400000000000n,
      endNs: 1785543600000000000n,
    });
    expect(resolvePlayArgs(chartStore)).toEqual({
      speed: 60,
      startNs: "1785542400000000000",
      endNs: "1785543600000000000",
    });
  });
});

describe("library selection ids", () => {
  afterEach(() => {
    chartStore.files = [];
    chartStore.selectedFileId = "";
    chartStore.activeFileId = "";
    chartStore.instrumentId = "";
  });

  it("clears active and selected ids when the file leaves the library", () => {
    const file = {
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
    chartStore.files = [file];
    chartStore.activeFileId = "file-1";
    chartStore.selectedFileId = "file-1";
    setFiles([]);
    expect(chartStore.activeFileId).toBe("");
    expect(chartStore.selectedFileId).toBe("");
  });
});
