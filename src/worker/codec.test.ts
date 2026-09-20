import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SocketFrameSchema } from "@proto/captain_nemo/v1/wire_pb.ts";
import { Conflator } from "./conflation.ts";
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
    const transferred: Transferable[] = [];
    const posted: unknown[] = [];
    const postMessage = (data: unknown, transfer?: Transferable[]) => {
      posted.push(data);
      transferred.push(...(transfer ?? []));
    };
    const frame = toBinary(SocketFrameSchema, goldenFrame());
    const buffer = frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
    postMessage({ nemo: "frame", byteLength: buffer.byteLength, kind: "bars", buffer }, [buffer]);
    expect((posted[0] as { nemo: string; kind: string }).nemo).toBe("frame");
    expect((posted[0] as { kind: string }).kind).toBe("bars");
    expect(transferred).toHaveLength(1);
    expect((transferred[0] as ArrayBuffer).byteLength).toBe(frame.byteLength);
  });

  it("encodes catalog and import commands without leaving empty oneof fields", () => {
    const listed = encodeCommand(2, { case: "listCatalog", value: {} });
    const imported = encodeCommand(3, {
      case: "importCsv",
      value: { path: "E:/data/sample.csv", instrumentId: "" },
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
});

describe("conflator", () => {
  it("keeps the latest bar and playback frames and passes errors through", () => {
    const flushed: Uint8Array[][] = [];
    const conflator = new Conflator(
      (frames) => flushed.push(frames),
      10_000,
      (bytes) => {
        const frame = decodeFrame(bytes);
        if (frame.kind.case === "bars") {
          return "bars";
        }
        if (frame.kind.case === "playback") {
          return "playback";
        }
        return "pass";
      },
    );
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
    conflator.push(first);
    conflator.push(second);
    conflator.push(error);
    expect(flushed).toHaveLength(1);
    expect(decodeFrame(flushed[0][0]).kind.case).toBe("error");
    conflator.emit();
    expect(flushed).toHaveLength(2);
    expect(decodeFrame(flushed[1][0]).kind.case).toBe("bars");
    if (decodeFrame(flushed[1][0]).kind.case === "bars") {
      expect(decodeFrame(flushed[1][0]).kind.value.instrumentId).toBe("B");
    }
  });

  it("keeps a later paused playback frame over an earlier playing one", () => {
    const flushed: Uint8Array[][] = [];
    const conflator = new Conflator(
      (frames) => flushed.push(frames),
      10_000,
      (bytes) => {
        const frame = decodeFrame(bytes);
        if (frame.kind.case === "playback") {
          return "playback";
        }
        return "pass";
      },
    );
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
    conflator.push(playing);
    conflator.push(paused);
    conflator.emit();
    expect(flushed).toHaveLength(1);
    const frame = decodeFrame(flushed[0][0]);
    expect(frame.kind.case).toBe("playback");
    if (frame.kind.case === "playback") {
      expect(frame.kind.value.playing).toBe(false);
      expect(frame.kind.value.cursorNs).toBe(20n);
    }
  });
});
