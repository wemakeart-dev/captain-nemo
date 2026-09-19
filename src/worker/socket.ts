import type { SocketFrame } from "@proto/captain_nemo/v1/wire_pb.ts";
import { decodeFrame, encodeCommand, isCommandReply, type CommandBodyInit } from "./codec.ts";
import { Conflator } from "./conflation.ts";

export class EngineSocket {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (frame: SocketFrame) => void; reject: (error: Error) => void }
  >();
  private conflator: Conflator;

  constructor(private readonly onFrames: (frames: Uint8Array[]) => void) {
    this.conflator = new Conflator(onFrames, 33, (bytes) => {
      const frame = decodeFrame(bytes);
      if (frame.kind.case === "bars") {
        return "bars";
      }
      if (frame.kind.case === "trades") {
        return "trades";
      }
      if (frame.kind.case === "playback") {
        return "playback";
      }
      return "pass";
    });
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(url: string): Promise<SocketFrame> {
    this.disconnect();
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      const onError = () => reject(new Error(`failed to connect to ${url}`));
      socket.addEventListener("error", onError, { once: true });
      socket.addEventListener("message", (event) => {
        const bytes = new Uint8Array(event.data as ArrayBuffer);
        const frame = decodeFrame(bytes);
        if (frame.kind.case === "hello") {
          this.conflator.start();
          socket.removeEventListener("error", onError);
          resolve(frame);
          return;
        }
        if (frame.correlationId !== 0 && this.pending.has(frame.correlationId) && isCommandReply(frame)) {
          const waiter = this.pending.get(frame.correlationId);
          this.pending.delete(frame.correlationId);
          waiter?.resolve(frame);
          return;
        }
        this.conflator.push(bytes);
      });
      socket.addEventListener("close", () => {
        this.conflator.stop();
        for (const waiter of this.pending.values()) {
          waiter.reject(new Error("socket closed"));
        }
        this.pending.clear();
      });
    });
  }

  disconnect(): void {
    this.conflator.stop();
    this.socket?.close();
    this.socket = null;
  }

  request(body: CommandBodyInit): Promise<SocketFrame> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("not connected"));
    }
    const correlationId = this.nextId++;
    const bytes = encodeCommand(correlationId, body);
    return new Promise((resolve, reject) => {
      this.pending.set(correlationId, { resolve, reject });
      this.socket?.send(bytes);
    });
  }
}
