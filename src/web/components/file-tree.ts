import { define, html } from "hybrids";
import { buildFileTree, type FolderNode, type TreeNode } from "../library/tree.ts";
import { chartStore, setActiveFileId, subscribeKeys } from "../store.ts";

type FileTreeHost = HTMLElement & {
  mode: string;
  collapsedIds: string;
};

function parseCollapsed(collapsedIds: string): Set<string> {
  return new Set(collapsedIds.split("\n").filter(Boolean));
}

export function toggleCollapsedIds(collapsedIds: string, id: string): string {
  if (!id) {
    return collapsedIds;
  }
  const ids = parseCollapsed(collapsedIds);
  if (ids.has(id)) {
    ids.delete(id);
  } else {
    ids.add(id);
  }
  return [...ids].join("\n");
}

function activateFile(_host: FileTreeHost, event: Event): void {
  const fileId = (event.currentTarget as HTMLElement).dataset.fileId ?? "";
  setActiveFileId(fileId);
}

function onFolderClick(host: FileTreeHost, event: Event): void {
  const button = event.currentTarget as HTMLElement;
  if (host.mode === "pick" && button.dataset.period) {
    host.dispatchEvent(
      new CustomEvent("nemo-period", {
        detail: {
          provider: button.dataset.provider,
          dataset: button.dataset.dataset,
          granularity: button.dataset.granularity,
          period: button.dataset.period,
        },
        bubbles: true,
        composed: true,
      }),
    );
    return;
  }
  host.collapsedIds = toggleCollapsedIds(host.collapsedIds, button.dataset.folderId ?? "");
}

function renderFile(host: FileTreeHost, node: Extract<TreeNode, { kind: "file" }>) {
  const file = node.file;
  const active = file.fileId === chartStore.activeFileId;
  const loaded = file.fileId === chartStore.selectedFileId;
  return html`
    <li class="${{ file: true, active, loaded }}">
      ${host.mode === "pick"
        ? html`<span class="name" title="${file.path}">${file.fileName}</span>`
        : html`<button
            type="button"
            class="name"
            data-file-id="${file.fileId}"
            title="${file.path}"
            onclick="${activateFile}"
          >
            ${file.fileName}
          </button>`}
    </li>
  `;
}

function renderFolder(host: FileTreeHost, node: FolderNode, collapsed: Set<string>) {
  const closed = collapsed.has(node.id);
  const taxonomy = node.taxonomy;
  return html`
    <li class="${{ folder: true, collapsed: closed }}">
      <button
        type="button"
        class="folder-row"
        data-folder-id="${node.id}"
        data-period="${taxonomy?.period ?? ""}"
        data-provider="${taxonomy?.provider ?? ""}"
        data-dataset="${taxonomy?.dataset ?? ""}"
        data-granularity="${taxonomy?.granularity ?? ""}"
        aria-expanded="${closed ? "false" : "true"}"
        onclick="${onFolderClick}"
      >
        <span class="chevron">${closed ? "▸" : "▾"}</span>
        <span>${node.label}</span>
      </button>
      <ul>
        ${node.children.map((child) =>
          child.kind === "file" ? renderFile(host, child) : renderFolder(host, child, collapsed),
        )}
      </ul>
    </li>
  `;
}

export const NemoFileTree = define({
  tag: "nemo-file-tree",
  mode: "browse",
  collapsedIds: "",
  render: {
    value: (host: FileTreeHost) => {
      const collapsed = parseCollapsed(host.collapsedIds);
      const tree = buildFileTree(chartStore.files);
      return html`
        <div class="tree">
          ${tree.length === 0
            ? html`<p class="empty">No files imported</p>`
            : html`<ul>
                ${tree.map((node) => renderFolder(host, node, collapsed))}
              </ul>`}
        </div>
      `.css`
        :host { display: block; }
        ul {
          list-style: none;
          margin: 0;
          padding: 0 0 0 0.7rem;
        }
        .tree > ul { padding-left: 0; }
        li.folder.collapsed > ul { display: none; }
        .folder-row, .name {
          font: inherit;
          color: #d5e2ee;
        }
        .folder-row, button.name {
          display: flex;
          align-items: center;
          gap: 0.3rem;
          width: 100%;
          text-align: left;
          background: none;
          border: 0;
          padding: 0.2rem 0.15rem;
          cursor: pointer;
        }
        button.name {
          padding: 0.15rem 0.1rem 0.15rem 1rem;
        }
        .file.active .name {
          background: #16324a;
          border-radius: 3px;
        }
        .file.loaded .name { color: #e3c565; }
        .chevron { width: 0.8rem; color: #9eb3c7; }
        .name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 0.8rem;
        }
        .empty {
          margin: 0.4rem 0;
          color: #6c8196;
          font-size: 0.8rem;
        }
      `;
    },
    connect: (_host: FileTreeHost, _key, invalidate) =>
      subscribeKeys(["files", "activeFileId", "selectedFileId"], invalidate),
  },
});
