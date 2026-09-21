import type { FileEntry, WorkerApi } from "../../worker/api.ts";
import { chartStore, clearChart, setActiveFileId, setCatalog, setFiles, setSelectedFileId, setStatus } from "../store.ts";

let queryGeneration = 0;

export async function refreshLibrary(api: Pick<WorkerApi, "listCatalog" | "listFiles">): Promise<void> {
  const [catalog, files] = await Promise.all([api.listCatalog(), api.listFiles()]);
  setCatalog(catalog);
  setFiles(files);
}

export async function selectFile(
  file: FileEntry,
  api: Pick<WorkerApi, "queryBars" | "resetPlayback">,
  barStep = chartStore.barStep,
): Promise<void> {
  const generation = ++queryGeneration;
  setSelectedFileId(file.fileId);
  setStatus("Loading bars…");
  try {
    try {
      await api.resetPlayback();
    } catch {
      // No bound playback session yet.
    }
    const result = await api.queryBars(file.instrumentId, barStep, file.startNs, file.endNs);
    if (generation !== queryGeneration) {
      return;
    }
    setStatus(`Loaded ${result.barCount} bars`);
  } catch (error) {
    if (generation !== queryGeneration) {
      return;
    }
    setStatus(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function reloadSelectedFile(
  api: Pick<WorkerApi, "queryBars" | "resetPlayback">,
  barStep = chartStore.barStep,
): Promise<void> {
  const file = chartStore.files.find((item) => item.fileId === chartStore.selectedFileId);
  if (!file) {
    return;
  }
  await selectFile(file, api, barStep);
}

export function clearSelectionIfRemoved(fileId: string): void {
  if (chartStore.activeFileId === fileId) {
    setActiveFileId("");
  }
  if (chartStore.selectedFileId === fileId) {
    setSelectedFileId("");
    clearChart();
  }
}
