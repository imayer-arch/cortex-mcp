import fs from "node:fs";
import path from "node:path";

const ENV_LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const PROCESS_ENV = /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;
const CONFIG_GET = /config(?:Service)?\.get\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export function extractEnvFromExample(repoPath: string): string[] {
  const vars: string[] = [];
  const candidates = [".env.example", ".env.sample", ".env.dev", ".env.desa"];
  for (const name of candidates) {
    const full = path.join(repoPath, name);
    if (!fs.existsSync(full)) continue;
    try {
      const content = fs.readFileSync(full, "utf-8");
      for (const line of content.split("\n")) {
        const match = line.match(ENV_LINE);
        if (match) vars.push(match[1]);
      }
    } catch {
      /* ignore */
    }
  }
  return [...new Set(vars)];
}

export function extractEnvFromCode(repoPath: string): string[] {
  const vars = new Set<string>();
  const dir = path.join(repoPath, "src");
  if (!fs.existsSync(dir)) return [];

  function scan(dirPath: string): void {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dirPath, e.name);
      if (e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith(".")) {
        scan(full);
        continue;
      }
      if (!e.isFile() || (!e.name.endsWith(".ts") && !e.name.endsWith(".js"))) continue;
      try {
        const content = fs.readFileSync(full, "utf-8");
        let m: RegExpExecArray | null;
        while ((m = PROCESS_ENV.exec(content)) !== null) vars.add(m[1]);
        const configRegex = new RegExp(CONFIG_GET.source, "g");
        while ((m = configRegex.exec(content)) !== null) vars.add(m[1]);
      } catch {
        /* ignore */
      }
    }
  }
  scan(dir);
  return [...vars];
}

export function collectEnvVars(repoPath: string): string[] {
  const fromExample = extractEnvFromExample(repoPath);
  const fromCode = extractEnvFromCode(repoPath);
  return [...new Set([...fromExample, ...fromCode])].sort();
}
