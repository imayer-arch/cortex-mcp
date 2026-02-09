import fs from "node:fs";
import path from "node:path";

const EXCLUDE = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".cursor",
  "coverage", ".vscode", "docs", "k8s", "scripts", "movil-mcp-workspace",
  "cortex-mcp", "MCP-CURSOR-BD", "QUERIES BD", ".cortex-cache",
]);

function readJsonSafe<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function humanizeDirName(dir: string): string {
  return dir
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(" ");
}

export function detectNestJs(absolutePath: string): boolean {
  const pkgPath = path.join(absolutePath, "package.json");
  if (!fs.existsSync(pkgPath)) return false;
  const pkg = readJsonSafe<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(pkgPath);
  if (!pkg) return false;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps?.["@nestjs/core"] || deps?.["@nestjs/common"]) return true;
  if (fs.existsSync(path.join(absolutePath, "nest-cli.json"))) return true;
  return false;
}

export function detectExpress(absolutePath: string): boolean {
  if (detectNestJs(absolutePath)) return false;
  const pkgPath = path.join(absolutePath, "package.json");
  if (!fs.existsSync(pkgPath)) return false;
  const pkg = readJsonSafe<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(pkgPath);
  if (!pkg) return false;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return Boolean(deps?.express);
}

export interface DiscoveredRepo {
  id: string;
  name: string;
  type: "nestjs" | "express" | "sql" | "front" | "other";
  absolutePath: string;
  /** Relative to repo root, e.g. src/controllers */
  controllersPath: string;
  description?: string;
}

/**
 * Discover repos in workspace: NestJS, Express, moor-sql (DB), and others.
 */
export function discoverRepos(workspaceRoot: string): DiscoveredRepo[] {
  if (!fs.existsSync(workspaceRoot)) return [];
  const dirs = fs.readdirSync(workspaceRoot, { withFileTypes: true });
  const result: DiscoveredRepo[] = [];

  for (const d of dirs) {
    if (!d.isDirectory() || d.name.startsWith(".") || EXCLUDE.has(d.name)) continue;
    const absolutePath = path.join(workspaceRoot, d.name);

    if (d.name === "moor-sql") {
      result.push({
        id: d.name,
        name: humanizeDirName(d.name),
        type: "sql",
        absolutePath,
        controllersPath: "",
      });
      continue;
    }

    if (detectNestJs(absolutePath)) {
      const pkg = readJsonSafe<{ description?: string }>(path.join(absolutePath, "package.json"));
      result.push({
        id: d.name,
        name: humanizeDirName(d.name),
        type: "nestjs",
        absolutePath,
        controllersPath: "src/controllers",
        description: pkg?.description,
      });
      continue;
    }

    if (detectExpress(absolutePath)) {
      result.push({
        id: d.name,
        name: humanizeDirName(d.name),
        type: "express",
        absolutePath,
        controllersPath: "src",
        description: readJsonSafe<{ description?: string }>(path.join(absolutePath, "package.json"))?.description,
      });
      continue;
    }

    if (d.name === "movil-front" || d.name.endsWith("-front")) {
      result.push({
        id: d.name,
        name: humanizeDirName(d.name),
        type: "front",
        absolutePath,
        controllersPath: "",
      });
    }
  }

  return result;
}
