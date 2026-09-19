export type PendingFrames = {
  bars?: Uint8Array;
  trades?: Uint8Array;
  playback?: Uint8Array;
};

export class Conflator {
  private pending: PendingFrames = {};
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly onFlush: (frames: Uint8Array[]) => void,
    private readonly intervalMs = 33,
    private readonly classify: (bytes: Uint8Array) => keyof PendingFrames | "pass",
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

  push(bytes: Uint8Array): void {
    const kind = this.classify(bytes);
    if (kind === "pass") {
      this.onFlush([bytes]);
      return;
    }
    this.pending[kind] = bytes;
  }

  emit(): void {
    const frames = [this.pending.bars, this.pending.trades, this.pending.playback].filter(
      (frame): frame is Uint8Array => frame !== undefined,
    );
    this.pending = {};
    if (frames.length > 0) {
      this.onFlush(frames);
    }
  }
}
