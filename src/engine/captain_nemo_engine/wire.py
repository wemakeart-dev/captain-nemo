from captain_nemo_engine.paths import ensure_generated_path

ensure_generated_path()

from captain_nemo.v1 import wire_pb2 as wire


def new_frame(correlation_id: int = 0) -> wire.SocketFrame:
    frame = wire.SocketFrame()
    frame.correlation_id = correlation_id
    return frame


def hello_frame() -> bytes:
    frame = new_frame()
    frame.hello.version = "1"
    return frame.SerializeToString()


def error_frame(correlation_id: int, code: str, message: str) -> bytes:
    frame = new_frame(correlation_id)
    frame.error.code = code
    frame.error.message = message
    return frame.SerializeToString()


def decode_frame(payload: bytes) -> wire.SocketFrame:
    frame = wire.SocketFrame()
    frame.ParseFromString(payload)
    return frame
