import type { SocketFrame } from "@proto/captain_nemo/v1/wire_pb.ts";
import type { CatalogItem, ImportResult, PlaybackAck, QueryBarsResult, RpcRequest, WorkerApi } from "./api.ts";
import { decodeFrame } from "./codec.ts";
import { EngineSocket } from "./socket.ts";

function assertResult(frame: SocketFrame): SocketFrame {
  if (frame.kind.case === "error") {
    throw new Error(`${frame.kind.value.code}: ${frame.kind.value.message}`);
  }
  if (frame.kind.case !== "result") {
    throw new Error("expected command result");
  }
  return frame;
}

function transferFrames(frames: Uint8Array[]): void {
  const scope = self as DedicatedWorkerGlobalScope;
  for (const frame of frames) {
    const kind = decodeFrame(frame).kind.case ?? "unknown";
    const buffer = frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
    scope.postMessage({ nemo: "frame", buffer, byteLength: buffer.byteLength, kind }, [buffer]);
  }
}

const socket = new EngineSocket(transferFrames);

function bigintToString(value: bigint): string {
  return value.toString();
}

const api: WorkerApi = {
  async connect(url: string) {
    const hello = await socket.connect(url);
    if (hello.kind.case !== "hello") {
      throw new Error("engine did not send hello");
    }
    return { version: hello.kind.value.version };
  },

  async disconnect() {
    socket.disconnect();
  },

  async importCsv(path: string, instrumentId = "") {
    const frame = assertResult(
      await socket.request({
        case: "importCsv",
        value: { path, instrumentId: instrumentId ?? "" },
      }),
    );
    if (frame.kind.case !== "result" || frame.kind.value.body.case !== "importCsv") {
      throw new Error("unexpected import result");
    }
    const body = frame.kind.value.body.value;
    const result: ImportResult = {
      instrumentId: body.instrumentId,
      tradeCount: bigintToString(body.tradeCount),
      startNs: bigintToString(body.startNs),
      endNs: bigintToString(body.endNs),
    };
    return result;
  },

  async listCatalog() {
    const frame = assertResult(
      await socket.request({
        case: "listCatalog",
        value: {},
      }),
    );
    if (frame.kind.case !== "result" || frame.kind.value.body.case !== "listCatalog") {
      throw new Error("unexpected catalog result");
    }
    return frame.kind.value.body.value.items.map((item): CatalogItem => ({
      instrumentId: item.instrumentId,
      symbol: item.symbol,
      startNs: bigintToString(item.startNs),
      endNs: bigintToString(item.endNs),
      tradeCount: bigintToString(item.tradeCount),
    }));
  },

  async queryBars(instrumentId: string, barStep: string, startNs = "0", endNs = "0") {
    const frame = assertResult(
      await socket.request({
        case: "queryBars",
        value: {
          instrumentId,
          barStep,
          startNs: BigInt(startNs),
          endNs: BigInt(endNs),
        },
      }),
    );
    if (frame.kind.case !== "result" || frame.kind.value.body.case !== "queryBars") {
      throw new Error("unexpected query result");
    }
    const result: QueryBarsResult = { barCount: frame.kind.value.body.value.barCount };
    return result;
  },

  async play(instrumentId: string, barStep: string, speed: number, startNs = "0", endNs = "0") {
    const frame = assertResult(
      await socket.request({
        case: "startPlayback",
        value: {
          instrumentId,
          barStep,
          speed,
          startNs: BigInt(startNs),
          endNs: BigInt(endNs),
        },
      }),
    );
    if (frame.kind.case !== "result" || frame.kind.value.body.case !== "playback") {
      throw new Error("unexpected playback result");
    }
    const ack: PlaybackAck = {
      playing: frame.kind.value.body.value.playing,
      speed: frame.kind.value.body.value.speed,
    };
    return ack;
  },

  async pause() {
    const frame = assertResult(
      await socket.request({
        case: "stopPlayback",
        value: {},
      }),
    );
    if (frame.kind.case !== "result" || frame.kind.value.body.case !== "playback") {
      throw new Error("unexpected pause result");
    }
    const ack: PlaybackAck = {
      playing: frame.kind.value.body.value.playing,
      speed: frame.kind.value.body.value.speed,
    };
    return ack;
  },

  async setSpeed(speed: number) {
    const frame = assertResult(
      await socket.request({
        case: "setSpeed",
        value: { speed },
      }),
    );
    if (frame.kind.case !== "result" || frame.kind.value.body.case !== "playback") {
      throw new Error("unexpected speed result");
    }
    const ack: PlaybackAck = {
      playing: frame.kind.value.body.value.playing,
      speed: frame.kind.value.body.value.speed,
    };
    return ack;
  },
};

self.addEventListener("message", (event: MessageEvent<RpcRequest>) => {
  const data = event.data;
  if (!data || data.nemo !== "rpc") {
    return;
  }
  const method = api[data.method] as (...args: unknown[]) => Promise<unknown>;
  Promise.resolve(method(...data.args))
    .then((result) => {
      (self as DedicatedWorkerGlobalScope).postMessage({ nemo: "rpc-result", id: data.id, result });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      (self as DedicatedWorkerGlobalScope).postMessage({ nemo: "rpc-result", id: data.id, error: message });
    });
});

(self as DedicatedWorkerGlobalScope).postMessage({ nemo: "rpc-result", id: 0, result: { ready: true } });
