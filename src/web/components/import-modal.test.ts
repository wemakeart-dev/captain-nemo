import { afterEach, describe, expect, it } from "vitest";
import { NemoImportModal } from "./import-modal.ts";

describe("nemo-import-modal", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps Import disabled without a path and disables Futures options except trades", async () => {
    expect(NemoImportModal).toBeDefined();
    const el = document.createElement("nemo-import-modal") as HTMLElement & {
      path: string;
      dataset: DOMStringMap;
      granularity: string;
      periodValue: string;
    };
    document.body.append(el);
    await Promise.resolve();
    const root = el.shadowRoot;
    expect(root).toBeTruthy();
    const importBtn = root?.querySelector("[data-action=import]") as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
    const options = [...(root?.querySelectorAll("[data-field=dataset] option") ?? [])] as HTMLOptionElement[];
    expect(options.map((option) => option.value)).toContain("trades");
    expect(options.filter((option) => option.value !== "trades").every((option) => option.disabled)).toBe(true);
    expect(options.find((option) => option.value === "trades")?.disabled).toBe(false);
  });

  it("enables Import once path and period are set through host properties", async () => {
    const el = document.createElement("nemo-import-modal") as HTMLElement & {
      path: string;
      periodValue: string;
    };
    document.body.append(el);
    await Promise.resolve();
    el.path = "E:/data/BTCUSDC-trades-2026-08.csv";
    el.periodValue = "2026-08";
    await Promise.resolve();
    const importBtn = el.shadowRoot?.querySelector("[data-action=import]") as HTMLButtonElement;
    expect(importBtn.disabled).toBe(false);
  });
});
