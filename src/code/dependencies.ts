import fs from "node:fs";
import path from "node:path";
import { envToServiceId } from "./outbound-calls.js";

const SERVICE_ENV_PATTERN = /config(?:Service)?\.get\s*\(\s*['"]([^'"]+)['"]\s*\)|process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;
const AXIOS_GET_POST = /(?:axiosInstance|axios)\.(get|post|put|patch|delete)\s*\(\s*['"`]?([^'"`)\s]+)['"`]?|\.(get|post|put|patch|delete)\s*\(\s*['"`]?([^'"`)\s]+)['"`]?/g;

export interface ServiceCall {
  fromRepo: string;
  toService: string | null;
  envVar: string;
  method?: string;
  pathFragment?: string;
  filePath: string;
}

export function extractServiceCalls(
  repoPath: string,
  repoId: string,
  workspaceRoot: string,
  allRepoIds: string[]
): ServiceCall[] {
  const calls: ServiceCall[] = [];
  const srcDir = path.join(repoPath, "src");
  if (!fs.existsSync(srcDir)) return calls;

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
        if (!content.includes("configService") && !content.includes("process.env") && !content.includes("axios")) continue;

        const envRefs = [...content.matchAll(SERVICE_ENV_PATTERN)];
        for (const ref of envRefs) {
          const envVar = ref[1] || ref[2];
          if (!envVar) continue;
          const toService = envToServiceId(envVar, allRepoIds);
          if (toService && toService !== repoId) {
            calls.push({
              fromRepo: repoId,
              toService,
              envVar,
              filePath: relPath,
            });
          }
        }

        const methodCalls = [...content.matchAll(AXIOS_GET_POST)];
        for (const mc of methodCalls) {
          const method = (mc[1] || mc[3])?.toUpperCase();
          const pathFrag = mc[2] || mc[4];
          if (method && pathFrag) {
            const existing = calls.find((c) => c.filePath === relPath && !c.method);
            if (existing) {
              existing.method = method;
              existing.pathFragment = pathFrag;
            } else {
              calls.push({
                fromRepo: repoId,
                toService: null,
                envVar: "",
                method,
                pathFragment: pathFrag,
                filePath: relPath,
              });
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
  }
  scan(srcDir);
  return calls;
}
