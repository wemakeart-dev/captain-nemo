import { create, fromBinary, toBinary, type MessageInitShape } from "@bufbuild/protobuf";
import { CommandSchema, SocketFrameSchema, type SocketFrame } from "@proto/captain_nemo/v1/wire_pb.ts";

export type FrameKind = NonNullable<SocketFrame["kind"]["case"]>;

export function decodeFrame(bytes: Uint8Array): SocketFrame {
  return fromBinary(SocketFrameSchema, bytes);
}

export function isCommandReply(frame: SocketFrame): boolean {
  return frame.kind.case === "result" || frame.kind.case === "error";
}

export type SocketFrameInit = MessageInitShape<typeof SocketFrameSchema>;
export type CommandBodyInit = NonNullable<MessageInitShape<typeof CommandSchema>["body"]>;

export function encodeCommand(correlationId: number, body: CommandBodyInit): Uint8Array {
  return toBinary(
    SocketFrameSchema,
    create(SocketFrameSchema, {
      correlationId,
      kind: {
        case: "command",
        value: create(CommandSchema, { body }),
      },
    }),
  );
}
