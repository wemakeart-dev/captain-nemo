import type { FileEntry as ProtoFileEntry, SocketFrame } from "@proto/captain_nemo/v1/wire_pb.ts";
import type {
  CatalogItem,
  FileEntry,
  ImportCsvRequest,
  ImportResult,
  ImportVisionRequest,
  PlaybackAck,
  QueryBarsResult,
  RpcRequest,
  WorkerApi,
} from "./api.ts";
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

function mapFileEntry(item: ProtoFileEntry): FileEntry {
  return {
    fileId: item.fileId,
    provider: item.provider,
    dataset: item.dataset,
    granularity: item.granularity,
    period: item.period,
    periodKey: item.periodKey,
    fileName: item.fileName,
    path: item.path,
    instrumentId: item.instrumentId,
    symbol: item.symbol,
    startNs: bigintToString(item.startNs),
    endNs: bigintToString(item.endNs),
    tradeCount: bigintToString(item.tradeCount),
  };
}

function playbackAck(frame: SocketFrame): PlaybackAck {
  if (frame.kind.case !== "result" || frame.kind.value.body.case !== "playback") {
    throw new Error("unexpected playback result");
  }
  return {
    playing: frame.kind.value.body.value.playing,
    speed: frame.kind.value.body.value.speed,
  };
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

  async importCsv(request: ImportCsvRequest) {
    const frame = assertResult(
      await socket.request({
        case: "importCsv",
        value: {
          path: request.path,
          instrumentId: request.instrumentId ?? "",
          provider: request.provider ?? "",
          dataset: request.dataset ?? "",
          granularity: request.granularity ?? "",
          period: request.period ?? "",
        },
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
      fileId: body.fileId,
      path: body.path,
    };
    return result;
  },

  async importVision(request: ImportVisionRequest) {
    const frame = assertResult(
      await socket.request({
        case: "importVision",
        value: {
          symbol: request.symbol,
          tradingType: request.tradingType ?? "um",
          dataset: request.dataset ?? "trades",
          granularity: request.granularity ?? "",
          period: request.period ?? "",
          provider: request.provider ?? "Binance",
        },
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
      fileId: body.fileId,
      path: body.path,
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

  async listFiles() {
    const frame = assertResult(
      await socket.request({
        case: "listFiles",
        value: {},
      }),
    );
    if (frame.kind.case !== "result" || frame.kind.value.body.case !== "listFiles") {
      throw new Error("unexpected files result");
    }
    return frame.kind.value.body.value.items.map(mapFileEntry);
  },

  async removeFile(fileId: string) {
    const frame = assertResult(
      await socket.request({
        case: "removeFile",
        value: { fileId },
      }),
    );
    if (frame.kind.case !== "result" || frame.kind.value.body.case !== "removeFile") {
      throw new Error("unexpected remove result");
    }
    return { fileId: frame.kind.value.body.value.fileId };
  },

  async moveFile(fileId: string, provider: string, dataset: string, granularity: string, period: string) {
    const frame = assertResult(
      await socket.request({
        case: "moveFile",
        value: { fileId, provider, dataset, granularity, period },
      }),
    );
    if (frame.kind.case !== "result" || frame.kind.value.body.case !== "moveFile") {
      throw new Error("unexpected move result");
    }
    return mapFileEntry(frame.kind.value.body.value.file!);
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
    return playbackAck(frame);
  },

  async pause() {
    const frame = assertResult(
      await socket.request({
        case: "stopPlayback",
        value: {},
      }),
    );
    return playbackAck(frame);
  },

  async resetPlayback() {
    const frame = assertResult(
      await socket.request({
        case: "resetPlayback",
        value: {},
      }),
    );
    return playbackAck(frame);
  },

  async setSpeed(speed: number) {
    const frame = assertResult(
      await socket.request({
        case: "setSpeed",
        value: { speed },
      }),
    );
    return playbackAck(frame);
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
