import { afterEach, describe, expect, it } from "vitest";
import { NemoApp } from "./app.ts";
import { NemoChart } from "./chart.ts";
import { NemoControls } from "./controls.ts";
import { NemoFileManager } from "./file-manager.ts";
import { NemoWorkspace } from "./workspace.ts";

function cssText(el: HTMLElement): string {
  return [...(el.shadowRoot?.adoptedStyleSheets ?? [])]
    .flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText))
    .join("\n");
}

async function mount(tag: string): Promise<HTMLElement> {
  const el = document.createElement(tag);
  document.body.append(el);
  await Promise.resolve();
  await Promise.resolve();
  return el;
}

describe("viewport layout", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps the CSV path as the shrinking control so the toolbar stays on one row", async () => {
    expect(NemoControls).toBeDefined();
    const el = await mount("nemo-controls");
    const css = cssText(el);
    expect(css).toMatch(/flex-wrap:\s*nowrap/);
    expect(el.shadowRoot?.querySelector("label.wide")).toBeTruthy();
    expect(css).toMatch(/\.wide\s*\{[^}]*min-width:\s*0/);
    expect(css).not.toMatch(/min-width:\s*18rem/);
  });

  it("lets the workspace chart column and file manager shrink instead of overflowing", async () => {
    expect(NemoApp).toBeDefined();
    expect(NemoWorkspace).toBeDefined();
    expect(NemoFileManager).toBeDefined();
    expect(NemoChart).toBeDefined();
    const app = await mount("nemo-app");
    const workspace = app.shadowRoot?.querySelector("nemo-workspace") as HTMLElement;
    const manager = workspace?.shadowRoot?.querySelector("nemo-file-manager") as HTMLElement;
    const chart = workspace?.shadowRoot?.querySelector("nemo-chart") as HTMLElement;
    expect(workspace).toBeTruthy();
    expect(cssText(app)).toMatch(/minmax\(0,\s*1fr\)/);
    expect(cssText(app)).toMatch(/overflow:\s*hidden/);
    expect(cssText(workspace)).toMatch(/minmax\(0,\s*1fr\)/);
    expect(cssText(manager)).not.toMatch(/min-height:\s*480px/);
    expect(cssText(chart)).not.toMatch(/min-height:\s*480px/);
    expect(cssText(chart)).toMatch(/min-width:\s*0/);
  });
});
