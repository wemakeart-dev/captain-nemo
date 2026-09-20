import type { FrameMessage, RpcRequest, RpcResponse, WorkerApi } from "../worker/api.ts";
import { applyFrameBuffer, setStatus } from "./store.ts";

function isFrameMessage(data: unknown): data is FrameMessage {
  return Boolean(data && typeof data === "object" && (data as FrameMessage).nemo === "frame");
}

function isRpcResponse(data: unknown): data is RpcResponse {
  return Boolean(data && typeof data === "object" && (data as RpcResponse).nemo === "rpc-result");
}

export function createWorkerClient(): { api: WorkerApi; worker: Worker } {
  const worker = new Worker(new URL("../worker/index.ts", import.meta.url), { type: "module" });
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (isFrameMessage(event.data)) {
      applyFrameBuffer(event.data.buffer);
      return;
    }
    if (!isRpcResponse(event.data)) {
      return;
    }
    const waiter = pending.get(event.data.id);
    if (!waiter) {
      return;
    }
    pending.delete(event.data.id);
    if (event.data.error) {
      waiter.reject(new Error(event.data.error));
      return;
    }
    waiter.resolve(event.data.result);
  });

  worker.addEventListener("error", (event) => {
    setStatus(event.message || "Worker error");
  });

  function call<K extends keyof WorkerApi>(method: K, args: unknown[]): ReturnType<WorkerApi[K]> {
    const id = nextId++;
    const request: RpcRequest = { nemo: "rpc", id, method, args };
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage(request);
    });
    return promise as ReturnType<WorkerApi[K]>;
  }

  const api: WorkerApi = {
    connect: (url) => call("connect", [url]),
    disconnect: () => call("disconnect", []),
    importCsv: (request) => call("importCsv", [request]),
    importVision: (request) => call("importVision", [request]),
    listCatalog: () => call("listCatalog", []),
    listFiles: () => call("listFiles", []),
    removeFile: (fileId) => call("removeFile", [fileId]),
    moveFile: (fileId, provider, dataset, granularity, period) =>
      call("moveFile", [fileId, provider, dataset, granularity, period]),
    queryBars: (instrumentId, barStep, startNs = "0", endNs = "0") =>
      call("queryBars", [instrumentId, barStep, startNs ?? "0", endNs ?? "0"]),
    play: (instrumentId, barStep, speed, startNs = "0", endNs = "0") =>
      call("play", [instrumentId, barStep, speed, startNs ?? "0", endNs ?? "0"]),
    pause: () => call("pause", []),
    resetPlayback: () => call("resetPlayback", []),
    setSpeed: (speed) => call("setSpeed", [speed]),
  };

  return { api, worker };
}
