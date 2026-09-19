from captain_nemo_engine.paths import ensure_generated_path

ensure_generated_path()

from captain_nemo.v1 import wire_pb2 as wire


class StrategyStreamSeam:
    def order_event(
        self,
        instrument_id: str,
        order_id: str,
        side: str,
        order_type: str,
        quantity: str,
        price: str,
        status: str,
        ts_event_ns: int,
    ) -> wire.SocketFrame:
        frame = wire.SocketFrame()
        event = frame.order
        event.instrument_id = instrument_id
        event.order_id = order_id
        event.side = side
        event.order_type = order_type
        event.quantity = quantity
        event.price = price
        event.status = status
        event.ts_event_ns = ts_event_ns
        return frame

    def fill_event(
        self,
        instrument_id: str,
        order_id: str,
        trade_id: str,
        side: str,
        quantity: str,
        price: str,
        ts_event_ns: int,
    ) -> wire.SocketFrame:
        frame = wire.SocketFrame()
        event = frame.fill
        event.instrument_id = instrument_id
        event.order_id = order_id
        event.trade_id = trade_id
        event.side = side
        event.quantity = quantity
        event.price = price
        event.ts_event_ns = ts_event_ns
        return frame

    def position_snapshot(
        self,
        instrument_id: str,
        side: str,
        quantity: str,
        avg_px: str,
        unrealized_pnl: str,
        ts_event_ns: int,
    ) -> wire.SocketFrame:
        frame = wire.SocketFrame()
        event = frame.position
        event.instrument_id = instrument_id
        event.side = side
        event.quantity = quantity
        event.avg_px = avg_px
        event.unrealized_pnl = unrealized_pnl
        event.ts_event_ns = ts_event_ns
        return frame
