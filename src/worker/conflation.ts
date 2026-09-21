export type PendingKind = "bars" | "trades" | "playback";

export type FlushedFrame = {
  bytes: Uint8Array;
  kind: string;
};

export type PendingFrames = {
  bars?: FlushedFrame;
  trades?: FlushedFrame;
  playback?: FlushedFrame;
};

function isPendingKind(kind: string): kind is PendingKind {
  return kind === "bars" || kind === "trades" || kind === "playback";
}

export class Conflator {
  private pending: PendingFrames = {};
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly onFlush: (frames: FlushedFrame[]) => void,
    private readonly intervalMs = 33,
  ) {}

  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => this.emit(), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.emit();
  }

  push(kind: string, bytes: Uint8Array): void {
    const frame: FlushedFrame = { bytes, kind };
    if (!isPendingKind(kind)) {
      this.onFlush([frame]);
      return;
    }
    this.pending[kind] = frame;
  }

  emit(): void {
    const frames = [this.pending.bars, this.pending.trades, this.pending.playback].filter(
      (frame): frame is FlushedFrame => frame !== undefined,
    );
    this.pending = {};
    if (frames.length > 0) {
      this.onFlush(frames);
    }
  }
}

export function toFrameBatchMessage(frames: FlushedFrame[]): {
  message: { nemo: "frames"; buffers: ArrayBuffer[]; kinds: string[] };
  transfer: Transferable[];
} {
  const buffers = frames.map((frame) =>
    frame.bytes.buffer.slice(frame.bytes.byteOffset, frame.bytes.byteOffset + frame.bytes.byteLength),
  );
  return {
    message: {
      nemo: "frames",
      buffers,
      kinds: frames.map((frame) => frame.kind),
    },
    transfer: buffers,
  };
}
