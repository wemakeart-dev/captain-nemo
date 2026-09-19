import type { WorkerApi } from "../worker/api.ts";

export let engineApi: WorkerApi | null = null;

export function setEngineApi(api: WorkerApi): void {
  engineApi = api;
}
