import { afterEach, describe, expect, it } from "vitest";
import { create, toBinary } from "@bufbuild/protobuf";
import { SocketFrameSchema } from "@proto/captain_nemo/v1/wire_pb.ts";
import { applyFrameBuffer, setStatus } from "../store.ts";
import { NemoStatus } from "./status.ts";

describe("nemo-status", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    setStatus("Disconnected");
  });

  it("renders the chart store status text", async () => {
    expect(NemoStatus).toBeDefined();
    setStatus("Engine v1");
    const el = document.createElement("nemo-status");
    document.body.append(el);
    await Promise.resolve();
    expect(el.shadowRoot?.textContent).toContain("Engine v1");
  });

  it("does not rebuild on a playback tick", async () => {
    setStatus("Engine v1");
    const el = document.createElement("nemo-status");
    document.body.append(el);
    await Promise.resolve();
    const paragraph = el.shadowRoot?.querySelector("p");
    const bytes = toBinary(
      SocketFrameSchema,
      create(SocketFrameSchema, {
        kind: {
          case: "playback",
          value: {
            instrumentId: "BTCUSDC-PERP.BINANCE",
            cursorNs: 1n,
            speed: 1,
            playing: true,
            startNs: 1n,
            endNs: 2n,
          },
        },
      }),
    );
    applyFrameBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    await Promise.resolve();
    expect(el.shadowRoot?.querySelector("p")).toBe(paragraph);
    expect(el.shadowRoot?.textContent).toContain("Engine v1");
  });
});
