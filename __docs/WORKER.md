# Worker layer

The worker is a browser `Worker` (`src/worker`), not a Node process. It sits between the Hybrids UI and the Nautilus engine WebSocket.

## Responsibilities

- Own the WebSocket (`binaryType = "arraybuffer"`)
- Encode/decode `captain_nemo.v1.SocketFrame` using protobuf-es generated code
- Correlate command/response frames
- Conflate high-rate `BarBatch`, `TradeBatch`, and `PlaybackState` frames on a ~33ms clock
- Transfer each flush as one `{ nemo: "frames", buffers, kinds }` message with transferable protobuf bytes
- Expose a typed command API over `postMessage` RPC (`{ nemo: "rpc" }` / `{ nemo: "rpc-result" }`)

## Why this split

Structured clone of decoded objects would copy large graphs onto the UI thread. The worker may decode in order to conflate, then forwards **raw protobuf bytes**. The UI decodes once before paint.

Command RPC uses a small `postMessage` protocol (`{ nemo: "rpc" }`). Market data does not.

## Control plane

`src/worker/index.ts` handles RPC methods:

- `connect` / `disconnect`
- `importCsv` (request object: filesystem path plus provider / dataset / granularity / period; not file bytes)
- `importVision` (symbol, trading type, dataset, granularity, period, provider; engine builds the Vision URL)
- `listCatalog`
- `listFiles` / `removeFile` / `moveFile`
- `queryBars`
- `play` / `pause` / `resetPlayback` / `setSpeed`

Nanosecond integers are returned to the UI as strings so RPC payloads stay JSON-safe.

## Data plane

`EngineSocket` treats `result` and `error` frames with a non-zero `correlation_id` as command replies. Everything else goes to `Conflator`:

- Latest bars frame
- Latest trades frame
- Latest playback frame
- Errors, hello (after connect), and reserved strategy events pass through immediately

On flush, the pending bars/trades/playback `Uint8Array`s are sliced into standalone `ArrayBuffer`s and posted as one transferable batch. The worker drops its handles.

The UI listens for `{ nemo: "frames", buffers, kinds }` and `{ nemo: "rpc-result" }`. Kind is classified from the already-decoded WebSocket frame; the worker does not decode protobuf again to flush.

## Layout

| File | Role |
| --- | --- |
| `src/worker/index.ts` | RPC endpoint + transferable flush |
| `src/worker/socket.ts` | WebSocket + correlation map |
| `src/worker/conflation.ts` | Interval merge |
| `src/worker/codec.ts` | `fromBinary` helpers |
| `src/worker/api.ts` | Shared `WorkerApi` types |

## Tests

`yarn test:worker` covers conflation (including a later paused `PlaybackState` winning over an earlier playing frame), a single transferable `{ nemo: "frames" }` batch, flush kinds without a second protobuf decode, and the protobuf contract (Python golden bytes decoded by protobuf-es), including library / reset / `importVision` commands encoded without empty oneofs.
