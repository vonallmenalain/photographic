import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const loaded = new Set<string>();

export function loadLocalEnv(): void {
  for (const filename of [".env", ".env.local"]) {
    const path = join(process.cwd(), filename);
    if (loaded.has(path) || !existsSync(path)) {
      continue;
    }

    loaded.add(path);
    const lines = readFileSync(path, "utf8").split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separator = trimmed.indexOf("=");
      if (separator === -1) {
        continue;
      }

      const key = trimmed.slice(0, separator).trim();
      const rawValue = trimmed.slice(separator + 1).trim();

      if (!key || process.env[key] !== undefined) {
        continue;
      }

      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}
