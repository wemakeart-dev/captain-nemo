export type CatalogItem = {
  instrumentId: string;
  symbol: string;
  startNs: string;
  endNs: string;
  tradeCount: string;
};

export type ImportResult = {
  instrumentId: string;
  tradeCount: string;
  startNs: string;
  endNs: string;
};

export type QueryBarsResult = {
  barCount: number;
};

export type PlaybackAck = {
  playing: boolean;
  speed: number;
};

export type WorkerApi = {
  connect(url: string): Promise<{ version: string }>;
  disconnect(): Promise<void>;
  importCsv(path: string, instrumentId?: string): Promise<ImportResult>;
  listCatalog(): Promise<CatalogItem[]>;
  queryBars(instrumentId: string, barStep: string, startNs?: string, endNs?: string): Promise<QueryBarsResult>;
  play(instrumentId: string, barStep: string, speed: number, startNs?: string, endNs?: string): Promise<PlaybackAck>;
  pause(): Promise<PlaybackAck>;
  setSpeed(speed: number): Promise<PlaybackAck>;
};

export type RpcRequest = {
  nemo: "rpc";
  id: number;
  method: keyof WorkerApi;
  args: unknown[];
};

export type RpcResponse = {
  nemo: "rpc-result";
  id: number;
  result?: unknown;
  error?: string;
};

export type FrameMessage = {
  nemo: "frame";
  buffer: ArrayBuffer;
  byteLength: number;
  kind: string;
};
