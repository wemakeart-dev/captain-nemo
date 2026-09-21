import { create } from "@bufbuild/protobuf";
import { PlaybackStateSchema } from "@proto/captain_nemo/v1/wire_pb.ts";
import type { Bar, PlaybackState, Trade } from "@proto/captain_nemo/v1/wire_pb.ts";
import type { FileEntry, PlaybackAck } from "../worker/api.ts";
import { decodeFrame } from "../worker/codec.ts";

export type CandlePoint = [number, number, number, number, number];

export type ChartSnapshot = {
  instrumentId: string;
  barStep: string;
  candles: CandlePoint[];
  trades: Trade[];
  playback: PlaybackState | null;
  speed: number;
  status: string;
  connected: boolean;
  catalog: { instrumentId: string; symbol: string; tradeCount: string }[];
  files: FileEntry[];
  activeFileId: string;
  selectedFileId: string;
  fileManagerOpen: boolean;
  playbackBusy: boolean;
};

export type PlayArgs = {
  speed: number;
  startNs: string;
  endNs: string;
};

export type MergeResult = {
  candles: CandlePoint[];
  changed: boolean;
};

const listeners = new Set<() => void>();

export const chartStore: ChartSnapshot = {
  instrumentId: "",
  barStep: "1m",
  candles: [],
  trades: [],
  playback: null,
  speed: 1,
  status: "Disconnected",
  connected: false,
  catalog: [],
  files: [],
  activeFileId: "",
  selectedFileId: "",
  fileManagerOpen: true,
  playbackBusy: false,
};

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeKeys(keys: (keyof ChartSnapshot)[], listener: () => void): () => void {
  let snapshot = keys.map((key) => chartStore[key]);
  return subscribe(() => {
    const next = keys.map((key) => chartStore[key]);
    if (next.every((value, index) => value === snapshot[index])) {
      return;
    }
    snapshot = next;
    listener();
  });
}

export function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function setStatus(status: string): void {
  chartStore.status = status;
  notify();
}

export function setConnected(connected: boolean): void {
  chartStore.connected = connected;
  notify();
}

export function setCatalog(catalog: ChartSnapshot["catalog"]): void {
  chartStore.catalog = catalog;
  if (!chartStore.instrumentId && catalog[0]) {
    chartStore.instrumentId = catalog[0].instrumentId;
  }
  notify();
}

export function setFiles(files: FileEntry[]): void {
  chartStore.files = files;
  if (chartStore.activeFileId && !files.some((item) => item.fileId === chartStore.activeFileId)) {
    chartStore.activeFileId = "";
  }
  if (chartStore.selectedFileId && !files.some((item) => item.fileId === chartStore.selectedFileId)) {
    chartStore.selectedFileId = "";
  }
  notify();
}

export function setActiveFileId(fileId: string): void {
  chartStore.activeFileId = fileId;
  notify();
}

export function setSelectedFileId(fileId: string): void {
  chartStore.selectedFileId = fileId;
  const file = chartStore.files.find((item) => item.fileId === fileId);
  if (file) {
    chartStore.instrumentId = file.instrumentId;
    chartStore.activeFileId = fileId;
  }
  notify();
}

export function setFileManagerOpen(open: boolean): void {
  chartStore.fileManagerOpen = open;
  notify();
}

export function setPlaybackBusy(busy: boolean): void {
  if (chartStore.playbackBusy === busy) {
    return;
  }
  chartStore.playbackBusy = busy;
  notify();
}

export function clearChart(): void {
  chartStore.candles = [];
  chartStore.trades = [];
  chartStore.playback = null;
  notify();
}

export function selectedFile(store: ChartSnapshot = chartStore): FileEntry | undefined {
  return store.files.find((item) => item.fileId === store.selectedFileId);
}

export function hasSelectedFile(store: ChartSnapshot = chartStore): boolean {
  return Boolean(store.selectedFileId);
}

export function setInstrument(instrumentId: string): void {
  chartStore.instrumentId = instrumentId;
  notify();
}

export function setBarStep(barStep: string): void {
  chartStore.barStep = barStep;
  notify();
}

export function setSpeed(speed: number): void {
  chartStore.speed = speed > 0 ? speed : 1;
  notify();
}

export function resolvePlayArgs(store: ChartSnapshot): PlayArgs {
  const speed = store.speed > 0 ? store.speed : 1;
  const selected = selectedFile(store);
  const endNs = selected?.endNs ?? "0";
  const playback = store.playback;
  if (
    playback &&
    !playback.playing &&
    playback.cursorNs > 0n &&
    playback.cursorNs < playback.endNs &&
    playback.instrumentId === store.instrumentId &&
    playback.cursorNs !== playback.startNs
  ) {
    return { speed, startNs: playback.cursorNs.toString(), endNs };
  }
  return { speed, startNs: selected?.startNs ?? "0", endNs };
}

export function applyPlaybackAck(ack: PlaybackAck): void {
  const prev = chartStore.playback;
  const speed = ack.speed > 0 ? ack.speed : (prev?.speed ?? chartStore.speed);
  chartStore.playback = create(PlaybackStateSchema, {
    instrumentId: prev?.instrumentId || chartStore.instrumentId,
    cursorNs: prev?.cursorNs ?? 0n,
    speed,
    playing: ack.playing,
    startNs: prev?.startNs ?? 0n,
    endNs: prev?.endNs ?? 0n,
  });
  if (ack.speed > 0) {
    chartStore.speed = ack.speed;
  }
  notify();
}

function nsToMs(value: bigint): number {
  return Number(value / 1_000_000n);
}

function candleFromBar(bar: Bar): CandlePoint {
  return [
    nsToMs(bar.tsEventNs),
    Number(bar.open),
    Number(bar.close),
    Number(bar.low),
    Number(bar.high),
  ];
}

function indexOfTimestamp(candles: CandlePoint[], ts: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const value = candles[mid]?.[0];
    if (value === ts) {
      return mid;
    }
    if (value !== undefined && value < ts) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return -1;
}

function allTimestampsExist(candles: CandlePoint[], points: CandlePoint[]): boolean {
  for (const point of points) {
    if (indexOfTimestamp(candles, point[0]) < 0) {
      return false;
    }
  }
  return true;
}

export function mergeCandleDeltas(existing: CandlePoint[], points: CandlePoint[]): MergeResult {
  if (points.length === 0) {
    return { candles: existing, changed: false };
  }
  if (existing.length === 0) {
    return { candles: points, changed: true };
  }
  if (allTimestampsExist(existing, points)) {
    return { candles: existing, changed: false };
  }
  const lastTs = existing[existing.length - 1]?.[0] ?? 0;
  const firstTs = points[0]?.[0] ?? 0;
  if (firstTs >= lastTs) {
    const next = existing.slice();
    let index = 0;
    if (firstTs === lastTs) {
      next[next.length - 1] = points[0]!;
      index = 1;
    }
    for (; index < points.length; index += 1) {
      next.push(points[index]!);
    }
    return { candles: next, changed: true };
  }
  const merged = new Map(existing.map((point) => [point[0], point]));
  for (const point of points) {
    merged.set(point[0], point);
  }
  return { candles: [...merged.values()].sort((a, b) => a[0] - b[0]), changed: true };
}

function applyDecodedBytes(bytes: Uint8Array): boolean {
  const frame = decodeFrame(bytes);
  if (frame.kind.case === "bars") {
    const batch = frame.kind.value;
    if (batch.barStep && batch.barStep !== chartStore.barStep) {
      return false;
    }
    const points = batch.bars.map(candleFromBar);
    if (batch.snapshot) {
      chartStore.candles = points;
      chartStore.instrumentId = batch.instrumentId || chartStore.instrumentId;
      chartStore.barStep = batch.barStep || chartStore.barStep;
      return true;
    }
    const merged = mergeCandleDeltas(chartStore.candles, points);
    if (!merged.changed) {
      return false;
    }
    chartStore.candles = merged.candles;
    return true;
  }
  if (frame.kind.case === "trades") {
    chartStore.trades = frame.kind.value.trades.slice(-200);
    return true;
  }
  if (frame.kind.case === "playback") {
    chartStore.playback = frame.kind.value;
    if (frame.kind.value.speed > 0) {
      chartStore.speed = frame.kind.value.speed;
    }
    return true;
  }
  return false;
}

export function applyFrameBuffer(buffer: ArrayBuffer): void {
  if (applyDecodedBytes(new Uint8Array(buffer))) {
    notify();
  }
}

export function applyFrameBuffers(buffers: ArrayBuffer[]): void {
  let changed = false;
  for (const buffer of buffers) {
    if (applyDecodedBytes(new Uint8Array(buffer))) {
      changed = true;
    }
  }
  if (changed) {
    notify();
  }
}

export function candlesToSeries(candles: CandlePoint[]): CandlePoint[] {
  return candles;
}
