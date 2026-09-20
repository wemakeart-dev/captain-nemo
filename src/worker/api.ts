export type CatalogItem = {
  instrumentId: string;
  symbol: string;
  startNs: string;
  endNs: string;
  tradeCount: string;
};

export type FileEntry = {
  fileId: string;
  provider: string;
  dataset: string;
  granularity: string;
  period: string;
  periodKey: string;
  fileName: string;
  path: string;
  instrumentId: string;
  symbol: string;
  startNs: string;
  endNs: string;
  tradeCount: string;
};

export type ImportCsvRequest = {
  path: string;
  instrumentId?: string;
  provider?: string;
  dataset?: string;
  granularity?: string;
  period?: string;
};

export type ImportVisionRequest = {
  symbol: string;
  tradingType?: string;
  dataset?: string;
  granularity?: string;
  period?: string;
  provider?: string;
};

export type ImportResult = {
  instrumentId: string;
  tradeCount: string;
  startNs: string;
  endNs: string;
  fileId: string;
  path: string;
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
  importCsv(request: ImportCsvRequest): Promise<ImportResult>;
  importVision(request: ImportVisionRequest): Promise<ImportResult>;
  listCatalog(): Promise<CatalogItem[]>;
  listFiles(): Promise<FileEntry[]>;
  removeFile(fileId: string): Promise<{ fileId: string }>;
  moveFile(
    fileId: string,
    provider: string,
    dataset: string,
    granularity: string,
    period: string,
  ): Promise<FileEntry>;
  queryBars(instrumentId: string, barStep: string, startNs?: string, endNs?: string): Promise<QueryBarsResult>;
  play(instrumentId: string, barStep: string, speed: number, startNs?: string, endNs?: string): Promise<PlaybackAck>;
  pause(): Promise<PlaybackAck>;
  resetPlayback(): Promise<PlaybackAck>;
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
