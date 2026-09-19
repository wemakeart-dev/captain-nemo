import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "src", "generated", "python");
if (!existsSync(root)) {
  process.exit(0);
}

function ensureInit(dir) {
  const initPath = join(dir, "__init__.py");
  if (!existsSync(initPath)) {
    writeFileSync(initPath, "");
  }
  for (const name of readdirSync(dir)) {
    const child = join(dir, name);
    if (statSync(child).isDirectory()) {
      ensureInit(child);
    }
  }
}

mkdirSync(root, { recursive: true });
ensureInit(root);
