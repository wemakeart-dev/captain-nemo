# Worker layer

The worker is a browser `Worker` (`src/worker`), not a Node process. It sits between the Hybrids UI and the Nautilus engine WebSocket.

## Responsibilities

- Own the WebSocket (`binaryType = "arraybuffer"`)
- Encode/decode `captain_nemo.v1.SocketFrame` using protobuf-es generated code
- Correlate command/response frames
- Conflate high-rate `BarBatch`, `TradeBatch`, and `PlaybackState` frames on a ~33ms clock
- Transfer flushed frame bytes to the main thread with `postMessage(..., [buffer])`
- Expose a typed command API over `postMessage` RPC (`{ nemo: "rpc" }` / `{ nemo: "rpc-result" }`)

## Why this split

Structured clone of decoded objects would copy large graphs onto the UI thread. The worker may decode in order to conflate, then forwards **raw protobuf bytes**. The UI decodes once before paint.

Command RPC uses a small `postMessage` protocol (`{ nemo: "rpc" }`). Market data does not.

## Control plane

`src/worker/index.ts` handles RPC methods:

- `connect` / `disconnect`
- `importCsv` (filesystem path string; not file bytes)
- `listCatalog`
- `queryBars`
- `play` / `pause` / `setSpeed`

Nanosecond integers are returned to the UI as strings so RPC payloads stay JSON-safe.

## Data plane

`EngineSocket` treats `result` and `error` frames with a non-zero `correlation_id` as command replies. Everything else goes to `Conflator`:

- Latest bars frame
- Latest trades frame
- Latest playback frame
- Errors, hello (after connect), and reserved strategy events pass through immediately

On flush, each `Uint8Array` is sliced into a standalone `ArrayBuffer` and transferred. The worker drops its handle.

The UI listens for `{ nemo: "frame", buffer, byteLength, kind }` and `{ nemo: "rpc-result" }`.

## Layout

| File | Role |
| --- | --- |
| `src/worker/index.ts` | RPC endpoint + transferable flush |
| `src/worker/socket.ts` | WebSocket + correlation map |
| `src/worker/conflation.ts` | Interval merge |
| `src/worker/codec.ts` | `fromBinary` helpers |
| `src/worker/api.ts` | Shared `WorkerApi` types |

## Tests

`yarn test:worker` covers conflation (including a later paused `PlaybackState` winning over an earlier playing frame), transferable `postMessage` framing, and the protobuf contract (Python golden bytes decoded by protobuf-es).
