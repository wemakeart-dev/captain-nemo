import { define, html } from "hybrids";
import type { FileEntry } from "../../worker/api.ts";
import { actionEnabled, fileForAction } from "../library/actions.ts";
import { clearSelectionIfRemoved, refreshLibrary, selectFile } from "../library/select.ts";
import { importReady, inputFromPeriod, periodFromInput } from "../library/taxonomy.ts";
import { engineApi } from "../session.ts";
import { chartStore, setFileManagerOpen, setStatus, subscribeKeys } from "../store.ts";
import "./file-tree.ts";
import { fieldCss, taxonomyFields } from "./taxonomy-fields.ts";

type FileManagerHost = HTMLElement & {
  movingFileId: string;
  provider: string;
  futures: string;
  granularity: string;
  periodValue: string;
};

function iconSelect() {
  return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
}

function iconRemove() {
  return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
}

function iconMove() {
  return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
}

function movingDraft(host: FileManagerHost) {
  return {
    path: "move",
    provider: host.provider || "Binance",
    dataset: host.futures || "trades",
    granularity: host.granularity || "monthly",
    period: periodFromInput(host.granularity || "monthly", host.periodValue),
  };
}

function targetFile(): FileEntry | undefined {
  return fileForAction(chartStore.files, chartStore.activeFileId);
}

async function handleSelect(): Promise<void> {
  const file = targetFile();
  if (!engineApi || !file) {
    return;
  }
  await selectFile(file, engineApi);
}

async function handleRemove(): Promise<void> {
  const file = targetFile();
  if (!engineApi || !file) {
    return;
  }
  try {
    await engineApi.removeFile(file.fileId);
    clearSelectionIfRemoved(file.fileId);
    await refreshLibrary(engineApi);
    setStatus(`Removed ${file.fileName}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function openMove(host: FileManagerHost): void {
  const file = targetFile();
  if (!file) {
    return;
  }
  host.movingFileId = file.fileId;
  host.provider = file.provider;
  host.futures = file.dataset;
  host.granularity = file.granularity;
  host.periodValue = inputFromPeriod(file.granularity, file.period);
  host.shadowRoot?.querySelector("dialog")?.showModal?.();
}

async function completeMove(
  host: FileManagerHost,
  taxonomy: { provider: string; dataset: string; granularity: string; period: string },
): Promise<void> {
  if (!engineApi || !host.movingFileId) {
    return;
  }
  try {
    await engineApi.moveFile(
      host.movingFileId,
      taxonomy.provider,
      taxonomy.dataset,
      taxonomy.granularity,
      taxonomy.period,
    );
    await refreshLibrary(engineApi);
    setStatus("Moved file");
    host.movingFileId = "";
    host.shadowRoot?.querySelector("dialog")?.close();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function toggleSidebar(): void {
  setFileManagerOpen(!chartStore.fileManagerOpen);
}

function onPeriodPick(host: FileManagerHost, event: Event): void {
  void completeMove(
    host,
    (event as CustomEvent<{ provider: string; dataset: string; granularity: string; period: string }>).detail,
  );
}

function moveToNewPeriod(host: FileManagerHost): void {
  const draft = movingDraft(host);
  if (!importReady(draft)) {
    return;
  }
  void completeMove(host, {
    provider: draft.provider,
    dataset: draft.dataset,
    granularity: draft.granularity,
    period: draft.period,
  });
}

export const NemoFileManager = define({
  tag: "nemo-file-manager",
  movingFileId: "",
  provider: "Binance",
  futures: "trades",
  granularity: "monthly",
  periodValue: "",
  render: {
    value: (host: FileManagerHost) => {
      const open = chartStore.fileManagerOpen;
      const enabled = actionEnabled(chartStore.activeFileId);
      host.classList.toggle("collapsed", !open);
      return html`
        <aside class="${{ shell: true, collapsed: !open }}">
          <button
            type="button"
            class="toggle"
            data-action="toggle"
            title="${open ? "Collapse file manager" : "Expand file manager"}"
            aria-label="${open ? "Collapse file manager" : "Expand file manager"}"
            onclick="${toggleSidebar}"
          >
            ${open ? "‹" : "›"}
          </button>
          ${open
            ? html`
                <div class="body">
                  <h2>Files</h2>
                  <nemo-file-tree class="browse" mode="browse"></nemo-file-tree>
                </div>
                <div class="bar">
                  <button type="button" class="bar-action" data-action="select" disabled="${!enabled}" onclick="${handleSelect}">
                    <span>Select Data</span>
                    ${iconSelect()}
                  </button>
                  <button type="button" class="bar-action" data-action="remove" disabled="${!enabled}" onclick="${handleRemove}">
                    <span>Remove</span>
                    ${iconRemove()}
                  </button>
                  <button type="button" class="bar-action" data-action="move" disabled="${!enabled}" onclick="${openMove}">
                    <span>Move</span>
                    ${iconMove()}
                  </button>
                </div>
              `
            : html``}
          <dialog>
            <form method="dialog">
              <h2>Move file</h2>
              <p>Pick an existing period folder or create a new branch.</p>
              <nemo-file-tree class="pick" mode="pick" onnemo-period="${onPeriodPick}"></nemo-file-tree>
              ${taxonomyFields(host)}
              <div class="actions">
                <button type="submit" value="cancel">Cancel</button>
                <button type="button" data-action="move-new" disabled="${!importReady(movingDraft(host))}" onclick="${moveToNewPeriod}">Move here</button>
              </div>
            </form>
          </dialog>
        </aside>
      `.css`
        ${fieldCss}
        :host {
          display: block;
          height: 100%;
          min-height: 0;
          min-width: 0;
          overflow: hidden;
        }
        :host(.collapsed) {
          width: 2.5rem;
        }
        .shell {
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          height: 100%;
          min-height: 0;
          width: 17rem;
          background: #0c1a26;
          border: 1px solid #2a4158;
          border-radius: 4px;
          box-sizing: border-box;
        }
        .shell.collapsed {
          width: 2.5rem;
          grid-template-rows: auto;
        }
        .toggle {
          width: 2rem;
          margin: 0.35rem;
          padding: 0.2rem 0;
          background: #16324a;
          border: 1px solid #2a4158;
          color: #e8eef5;
          cursor: pointer;
        }
        .body {
          padding: 0 0.7rem 0.35rem;
          overflow: auto;
          min-height: 0;
        }
        h2 {
          margin: 0 0 0.5rem;
          font-size: 0.78rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #9eb3c7;
          font-weight: 600;
        }
        .bar {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          padding: 0.55rem 0.7rem 0.7rem;
          border-top: 1px solid #2a4158;
        }
        .bar-action {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          width: 100%;
          box-sizing: border-box;
        }
        .bar-action svg { width: 0.9rem; height: 0.9rem; flex: none; }
        dialog {
          width: min(28rem, calc(100vw - 2rem));
          background: #0c1a26;
          color: #e8eef5;
          border: 1px solid #2a4158;
          border-radius: 6px;
        }
        form { display: grid; gap: 0.75rem; }
        p { margin: 0; color: #9eb3c7; font-size: 0.85rem; }
        .actions { display: flex; justify-content: end; gap: 0.6rem; }
      `;
    },
    connect: (_host: FileManagerHost, _key, invalidate) =>
      subscribeKeys(["activeFileId", "fileManagerOpen"], invalidate),
  },
});
