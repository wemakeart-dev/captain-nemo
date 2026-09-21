import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SocketFrameSchema } from "@proto/captain_nemo/v1/wire_pb.ts";
import { Conflator, toFrameBatchMessage } from "./conflation.ts";
import { decodeFrame, encodeCommand } from "./codec.ts";

const testdata = resolve(dirname(fileURLToPath(import.meta.url)), "../proto/testdata/golden_bar_batch.bin");

function goldenFrame() {
  return create(SocketFrameSchema, {
    kind: {
      case: "bars",
      value: {
        instrumentId: "BTCUSDC-PERP.BINANCE",
        barStep: "1m",
        snapshot: true,
        bars: [
          {
            tsEventNs: 1785542400000000000n,
            open: "62806.8",
            high: "62810.0",
            low: "62800.0",
            close: "62808.2",
            volume: "1.5",
            tradeCount: 3,
          },
        ],
      },
    },
  });
}

describe("protobuf contract", () => {
  it("round-trips a bar batch frame", () => {
    const encoded = toBinary(SocketFrameSchema, goldenFrame());
    const decoded = fromBinary(SocketFrameSchema, encoded);
    expect(decoded.kind.case).toBe("bars");
    if (decoded.kind.case !== "bars") {
      throw new Error("expected bars");
    }
    expect(decoded.kind.value.instrumentId).toBe("BTCUSDC-PERP.BINANCE");
    expect(decoded.kind.value.bars[0]?.open).toBe("62806.8");
    expect(existsSync(testdata)).toBe(true);
    expect(Buffer.from(encoded)).toEqual(readFileSync(testdata));
    const fromPython = fromBinary(SocketFrameSchema, new Uint8Array(readFileSync(testdata)));
    expect(fromPython.kind.case).toBe("bars");
    if (fromPython.kind.case === "bars") {
      expect(fromPython.kind.value.bars[0]?.close).toBe("62808.2");
      expect(fromPython.kind.value.bars[0]?.tsEventNs).toBe(1785542400000000000n);
    }
  });

  it("posts market frames with a transferable array buffer", () => {
    const frame = toBinary(SocketFrameSchema, goldenFrame());
    const { message, transfer } = toFrameBatchMessage([{ bytes: frame, kind: "bars" }]);
    expect(message.nemo).toBe("frames");
    expect(message.kinds).toEqual(["bars"]);
    expect(message.buffers).toHaveLength(1);
    expect(transfer).toHaveLength(1);
    expect((transfer[0] as ArrayBuffer).byteLength).toBe(frame.byteLength);
  });

  it("posts a conflated flush as one transferable batch", () => {
    const bars = toBinary(SocketFrameSchema, goldenFrame());
    const playback = toBinary(
      SocketFrameSchema,
      create(SocketFrameSchema, {
        kind: {
          case: "playback",
          value: { instrumentId: "A", playing: true, cursorNs: 10n, speed: 1 },
        },
      }),
    );
    const { message, transfer } = toFrameBatchMessage([
      { bytes: bars, kind: "bars" },
      { bytes: playback, kind: "playback" },
    ]);
    expect(message.buffers).toHaveLength(2);
    expect(message.kinds).toEqual(["bars", "playback"]);
    expect(transfer).toHaveLength(2);
  });

  it("encodes catalog and import commands without leaving empty oneof fields", () => {
    const listed = encodeCommand(2, { case: "listCatalog", value: {} });
    const imported = encodeCommand(3, {
      case: "importCsv",
      value: {
        path: "E:/data/sample.csv",
        instrumentId: "",
        provider: "Binance",
        dataset: "trades",
        granularity: "daily",
        period: "01-08-2026",
      },
    });
    expect(decodeFrame(listed).kind.case).toBe("command");
    expect(decodeFrame(imported).kind.case).toBe("command");
    if (decodeFrame(listed).kind.case === "command") {
      expect(decodeFrame(listed).kind.value.body.case).toBe("listCatalog");
    }
    if (decodeFrame(imported).kind.case === "command") {
      expect(decodeFrame(imported).kind.value.body.case).toBe("importCsv");
    }
  });

  it("encodes library and reset commands without leaving empty oneof fields", () => {
    const listed = encodeCommand(4, { case: "listFiles", value: {} });
    const removed = encodeCommand(5, { case: "removeFile", value: { fileId: "abc" } });
    const moved = encodeCommand(6, {
      case: "moveFile",
      value: {
        fileId: "abc",
        provider: "Binance",
        dataset: "trades",
        granularity: "monthly",
        period: "08-2026",
      },
    });
    const reset = encodeCommand(7, { case: "resetPlayback", value: {} });
    const vision = encodeCommand(8, {
      case: "importVision",
      value: {
        symbol: "BTCUSDC",
        tradingType: "um",
        dataset: "trades",
        granularity: "monthly",
        period: "08-2026",
        provider: "Binance",
      },
    });
    expect(decodeFrame(listed).kind.value.body.case).toBe("listFiles");
    expect(decodeFrame(removed).kind.value.body.case).toBe("removeFile");
    expect(decodeFrame(moved).kind.value.body.case).toBe("moveFile");
    expect(decodeFrame(reset).kind.value.body.case).toBe("resetPlayback");
    expect(decodeFrame(vision).kind.value.body.case).toBe("importVision");
  });
});

describe("conflator", () => {
  it("keeps the latest bar and playback frames and passes errors through", () => {
    const flushed: { bytes: Uint8Array; kind: string }[][] = [];
    const conflator = new Conflator((frames) => flushed.push(frames), 10_000);
    const first = toBinary(
      SocketFrameSchema,
      create(SocketFrameSchema, {
        kind: { case: "bars", value: { instrumentId: "A", snapshot: true } },
      }),
    );
    const second = toBinary(
      SocketFrameSchema,
      create(SocketFrameSchema, {
        kind: { case: "bars", value: { instrumentId: "B", snapshot: true } },
      }),
    );
    const error = toBinary(
      SocketFrameSchema,
      create(SocketFrameSchema, {
        kind: { case: "error", value: { code: "INTERNAL", message: "boom" } },
      }),
    );
    conflator.push("bars", first);
    conflator.push("bars", second);
    conflator.push("error", error);
    expect(flushed).toHaveLength(1);
    expect(flushed[0][0]?.kind).toBe("error");
    expect(decodeFrame(flushed[0][0]!.bytes).kind.case).toBe("error");
    conflator.emit();
    expect(flushed).toHaveLength(2);
    expect(flushed[1][0]?.kind).toBe("bars");
    expect(decodeFrame(flushed[1][0]!.bytes).kind.case).toBe("bars");
    if (decodeFrame(flushed[1][0]!.bytes).kind.case === "bars") {
      expect(decodeFrame(flushed[1][0]!.bytes).kind.value.instrumentId).toBe("B");
    }
  });

  it("keeps a later paused playback frame over an earlier playing one", () => {
    const flushed: { bytes: Uint8Array; kind: string }[][] = [];
    const conflator = new Conflator((frames) => flushed.push(frames), 10_000);
    const playing = toBinary(
      SocketFrameSchema,
      create(SocketFrameSchema, {
        kind: {
          case: "playback",
          value: { instrumentId: "A", playing: true, cursorNs: 10n, speed: 60 },
        },
      }),
    );
    const paused = toBinary(
      SocketFrameSchema,
      create(SocketFrameSchema, {
        kind: {
          case: "playback",
          value: { instrumentId: "A", playing: false, cursorNs: 20n, speed: 60 },
        },
      }),
    );
    conflator.push("playback", playing);
    conflator.push("playback", paused);
    conflator.emit();
    expect(flushed).toHaveLength(1);
    expect(flushed[0][0]?.kind).toBe("playback");
    const frame = decodeFrame(flushed[0][0]!.bytes);
    expect(frame.kind.case).toBe("playback");
    if (frame.kind.case === "playback") {
      expect(frame.kind.value.playing).toBe(false);
      expect(frame.kind.value.cursorNs).toBe(20n);
    }
  });
});
