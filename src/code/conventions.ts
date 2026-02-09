import fs from "node:fs";
import path from "node:path";

const IDEMPOTENCY = /idempotency[-_]?key|Idempotency[-_]?Key|X[-_]?Idempotency[-_]?Key/gi;
const USE_GUARDS = /@UseGuards\s*\([^)]+\)/g;
const ROLES = /@Roles\s*\(\s*\{[^}]*roles\s*:\s*\[[^\]]+\]/g;

export interface Convention {
  name: string;
  description: string;
  source: string;
  sourcePath: string;
  line?: number;
  count: number;
}

export function extractConventions(repoPath: string, repoId: string, workspaceRoot: string): Convention[] {
  const conventions: Convention[] = [];
  const srcDir = path.join(repoPath, "src");
  if (!fs.existsSync(srcDir)) return conventions;

  const idempotencyFiles: { path: string; line: number }[] = [];
  const guardsFiles: { path: string; line: number }[] = [];
  const rolesFiles: { path: string; line: number }[] = [];

  function scan(dirPath: string): void {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dirPath, e.name);
      if (e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith(".")) {
        scan(full);
        continue;
      }
      if (!e.isFile() || !e.name.endsWith(".ts")) continue;
      try {
        const content = fs.readFileSync(full, "utf-8");
        const relPath = path.relative(workspaceRoot, full).replace(/\\/g, "/");

        if (IDEMPOTENCY.test(content)) {
          const lines = content.split("\n");
          const line = lines.findIndex((l) => IDEMPOTENCY.test(l)) + 1;
          idempotencyFiles.push({ path: relPath, line: line || 0 });
        }
        if (content.includes("@UseGuards")) {
          const line = content.split("\n").findIndex((l) => l.includes("@UseGuards")) + 1;
          guardsFiles.push({ path: relPath, line: line || 0 });
        }
        if (content.includes("@Roles")) {
          const line = content.split("\n").findIndex((l) => l.includes("@Roles")) + 1;
          rolesFiles.push({ path: relPath, line: line || 0 });
        }
      } catch {
        /* ignore */
      }
    }
  }
  scan(srcDir);

  if (idempotencyFiles.length > 0) {
    conventions.push({
      name: "idempotency-key",
      description: "Uso de header Idempotency-Key en requests (pagos/operaciones idempotentes).",
      source: repoId,
      sourcePath: idempotencyFiles[0].path,
      line: idempotencyFiles[0].line,
      count: idempotencyFiles.length,
    });
  }
  if (guardsFiles.length > 0) {
    conventions.push({
      name: "use-guards",
      description: "Controladores protegidos con @UseGuards.",
      source: repoId,
      sourcePath: guardsFiles[0].path,
      line: guardsFiles[0].line,
      count: guardsFiles.length,
    });
  }
  if (rolesFiles.length > 0) {
    conventions.push({
      name: "roles",
      description: "Endpoints con @Roles (realm:PRODUCTOR, etc.).",
      source: repoId,
      sourcePath: rolesFiles[0].path,
      line: rolesFiles[0].line,
      count: rolesFiles.length,
    });
  }
  return conventions;
}
