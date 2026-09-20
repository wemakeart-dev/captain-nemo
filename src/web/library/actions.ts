import type { FileEntry } from "../../worker/api.ts";

export type FileAction = "select" | "remove" | "move";

export function actionEnabled(activeFileId: string): boolean {
  return Boolean(activeFileId);
}

export function fileForAction(files: FileEntry[], activeFileId: string): FileEntry | undefined {
  if (!activeFileId) {
    return undefined;
  }
  return files.find((item) => item.fileId === activeFileId);
}
