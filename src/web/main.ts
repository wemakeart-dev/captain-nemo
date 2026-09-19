import { setEngineApi } from "./session.ts";
import { createWorkerClient } from "./worker-client.ts";

const { api } = createWorkerClient();
setEngineApi(api);

await import("./components/app.ts");
