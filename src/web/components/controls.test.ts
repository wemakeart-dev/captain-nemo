import { afterEach, describe, expect, it, vi } from "vitest";
import { create, toBinary } from "@bufbuild/protobuf";
import { SocketFrameSchema } from "@proto/captain_nemo/v1/wire_pb.ts";
import type { WorkerApi } from "../../worker/api.ts";
import { setEngineApi } from "../session.ts";
import { applyFrameBuffer, chartStore, setConnected, setPlaybackBusy, setSelectedFileId, setStatus } from "../store.ts";
import { changeBarStep, NemoControls, pause, play, stopPlayback } from "./controls.ts";

function frameBuffer(frame: ReturnType<typeof create<typeof SocketFrameSchema>>): ArrayBuffer {
  const bytes = toBinary(SocketFrameSchema, frame);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("nemo-controls", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    setEngineApi(null);
    setConnected(false);
    setSelectedFileId("");
    setPlaybackBusy(false);
    chartStore.playback = null;
    chartStore.files = [];
    chartStore.selectedFileId = "";
    chartStore.barStep = "1m";
    setStatus("Disconnected");
  });

  it("renders Stop and no longer renders Load chart", async () => {
    expect(NemoControls).toBeDefined();
    const el = document.createElement("nemo-controls");
    document.body.append(el);
    await Promise.resolve();
    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("Stop");
    expect(text).not.toContain("Load chart");
    expect(el.shadowRoot?.querySelector("[data-action=stop]")).toBeTruthy();
    expect(el.shadowRoot?.querySelector("[data-action=load]")).toBeNull();
  });

  it("does not rebuild Play Pause Stop on a playback tick", async () => {
    const el = document.createElement("nemo-controls");
    document.body.append(el);
    await Promise.resolve();
    const playBtn = el.shadowRoot?.querySelector("[data-action=play]");
    const pauseBtn = el.shadowRoot?.querySelector("[data-action=pause]");
    const stopBtn = el.shadowRoot?.querySelector("[data-action=stop]");
    applyFrameBuffer(
      frameBuffer(
        create(SocketFrameSchema, {
          kind: {
            case: "playback",
            value: {
              instrumentId: "BTCUSDC-PERP.BINANCE",
              cursorNs: 1785542460000000000n,
              speed: 60,
              playing: true,
              startNs: 1785542400000000000n,
              endNs: 1785543600000000000n,
            },
          },
        }),
      ),
    );
    await Promise.resolve();
    expect(el.shadowRoot?.querySelector("[data-action=play]")).toBe(playBtn);
    expect(el.shadowRoot?.querySelector("[data-action=pause]")).toBe(pauseBtn);
    expect(el.shadowRoot?.querySelector("[data-action=stop]")).toBe(stopBtn);
  });

  it("ignores a second pause or stop while an RPC is in flight", async () => {
    let resolvePause: (value: { playing: boolean; speed: number }) => void = () => undefined;
    const pauseFn = vi.fn(
      () =>
        new Promise<{ playing: boolean; speed: number }>((resolve) => {
          resolvePause = resolve;
        }),
    );
    const resetFn = vi.fn().mockResolvedValue({ playing: false, speed: 1 });
    setEngineApi({ pause: pauseFn, resetPlayback: resetFn } as unknown as WorkerApi);
    const first = pause();
    const second = pause();
    const stopWhileBusy = stopPlayback();
    await Promise.resolve();
    expect(pauseFn).toHaveBeenCalledTimes(1);
    expect(resetFn).not.toHaveBeenCalled();
    resolvePause({ playing: false, speed: 1 });
    await first;
    await second;
    await stopWhileBusy;
    expect(pauseFn).toHaveBeenCalledTimes(1);
  });

  it("does not start a second play while the first RPC is in flight", async () => {
    chartStore.selectedFileId = "file-1";
    chartStore.files = [
      {
        fileId: "file-1",
        provider: "Binance",
        dataset: "trades",
        granularity: "monthly",
        period: "08-2026",
        periodKey: "2026-08",
        fileName: "BTCUSDC-trades-2026-08.csv",
        path: "E:/data/file.csv",
        instrumentId: "BTCUSDC-PERP.BINANCE",
        symbol: "BTCUSDC",
        startNs: "1785542400000000000",
        endNs: "1785543600000000000",
        tradeCount: "25",
      },
    ];
    const playFn = vi.fn(
      () =>
        new Promise<{ playing: boolean; speed: number }>(() => {
          /* pending */
        }),
    );
    setEngineApi({ play: playFn } as unknown as WorkerApi);
    void play();
    void play();
    await Promise.resolve();
    expect(playFn).toHaveBeenCalledTimes(1);
  });

  it("queries bars for the selected file when bar step changes", async () => {
    chartStore.selectedFileId = "file-1";
    chartStore.files = [
      {
        fileId: "file-1",
        provider: "Binance",
        dataset: "trades",
        granularity: "monthly",
        period: "08-2026",
        periodKey: "2026-08",
        fileName: "BTCUSDC-trades-2026-08.csv",
        path: "E:/data/file.csv",
        instrumentId: "BTCUSDC-PERP.BINANCE",
        symbol: "BTCUSDC",
        startNs: "1785542400000000000",
        endNs: "1785543600000000000",
        tradeCount: "25",
      },
    ];
    const queryBars = vi.fn().mockResolvedValue({ barCount: 9 });
    const resetPlayback = vi.fn().mockResolvedValue({ playing: false, speed: 1 });
    setEngineApi({ queryBars, resetPlayback } as unknown as WorkerApi);
    await changeBarStep("5m");
    expect(chartStore.barStep).toBe("5m");
    expect(queryBars).toHaveBeenCalledWith(
      "BTCUSDC-PERP.BINANCE",
      "5m",
      "1785542400000000000",
      "1785543600000000000",
    );
    expect(resetPlayback).toHaveBeenCalled();
  });
});
