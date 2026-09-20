import type { FileEntry } from "../../worker/api.ts";

export type FolderNode = {
  kind: "folder";
  id: string;
  label: string;
  children: TreeNode[];
  taxonomy?: {
    provider: string;
    dataset: string;
    granularity: string;
    period: string;
  };
};

export type FileNode = {
  kind: "file";
  id: string;
  label: string;
  file: FileEntry;
};

export type TreeNode = FolderNode | FileNode;

function compareLabel(left: string, right: string): number {
  return left.localeCompare(right);
}

function ensureFolder(parent: TreeNode[], id: string, label: string): FolderNode {
  const existing = parent.find((node): node is FolderNode => node.kind === "folder" && node.label === label);
  if (existing) {
    return existing;
  }
  const created: FolderNode = { kind: "folder", id, label, children: [] };
  parent.push(created);
  return created;
}

export function buildFileTree(files: FileEntry[]): FolderNode[] {
  const roots: TreeNode[] = [];
  const ordered = [...files].sort((left, right) => {
    return (
      compareLabel(left.provider, right.provider) ||
      compareLabel(left.dataset, right.dataset) ||
      compareLabel(left.granularity, right.granularity) ||
      compareLabel(left.periodKey, right.periodKey) ||
      compareLabel(left.fileName, right.fileName)
    );
  });
  for (const file of ordered) {
    const provider = ensureFolder(roots, `folder:${file.provider}`, file.provider);
    const dataset = ensureFolder(provider.children, `folder:${file.provider}/${file.dataset}`, file.dataset);
    const granularity = ensureFolder(
      dataset.children,
      `folder:${file.provider}/${file.dataset}/${file.granularity}`,
      file.granularity,
    );
    const period = ensureFolder(
      granularity.children,
      `folder:${file.provider}/${file.dataset}/${file.granularity}/${file.periodKey}`,
      file.period,
    );
    period.taxonomy = {
      provider: file.provider,
      dataset: file.dataset,
      granularity: file.granularity,
      period: file.period,
    };
    period.children.push({
      kind: "file",
      id: `file:${file.fileId}`,
      label: file.fileName,
      file,
    });
  }
  return roots.filter((node): node is FolderNode => node.kind === "folder");
}
