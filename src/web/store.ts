import { decodeFrame } from "../worker/codec.ts";
import type { Bar, PlaybackState, Trade } from "@proto/captain_nemo/v1/wire_pb.ts";

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
};

export type PlayArgs = {
  speed: number;
  startNs: string;
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
};

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
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
  const playback = store.playback;
  if (
    playback &&
    !playback.playing &&
    playback.cursorNs > 0n &&
    playback.cursorNs < playback.endNs &&
    playback.instrumentId === store.instrumentId
  ) {
    return { speed, startNs: playback.cursorNs.toString() };
  }
  return { speed, startNs: "0" };
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

export function applyFrameBuffer(buffer: ArrayBuffer): void {
  const frame = decodeFrame(new Uint8Array(buffer));
  if (frame.kind.case === "bars") {
    const batch = frame.kind.value;
    const points = batch.bars.map(candleFromBar);
    if (batch.snapshot) {
      chartStore.candles = points;
      chartStore.instrumentId = batch.instrumentId || chartStore.instrumentId;
      chartStore.barStep = batch.barStep || chartStore.barStep;
    } else {
      const merged = new Map(chartStore.candles.map((point) => [point[0], point]));
      for (const point of points) {
        merged.set(point[0], point);
      }
      chartStore.candles = [...merged.values()].sort((a, b) => a[0] - b[0]);
    }
    notify();
    return;
  }
  if (frame.kind.case === "trades") {
    chartStore.trades = frame.kind.value.trades.slice(-200);
    notify();
    return;
  }
  if (frame.kind.case === "playback") {
    chartStore.playback = frame.kind.value;
    if (frame.kind.value.speed > 0) {
      chartStore.speed = frame.kind.value.speed;
    }
    notify();
  }
}

export function candlesToSeries(candles: CandlePoint[]): CandlePoint[] {
  return candles;
}
