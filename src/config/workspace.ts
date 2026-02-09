import path from "node:path";

export function getWorkspaceRoot(): string {
  const env = process.env.WORKSPACE_ROOT;
  if (env) return path.resolve(env);
  return path.resolve(process.cwd());
}

/** Carpetas que no consideramos repos (no indexar su contenido como "source") */
export const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".cursor",
  "coverage",
  ".vscode",
  "docs",
  "k8s",
  "scripts",
  "movil-mcp-workspace",
  "cortex-mcp",
  "MCP-CURSOR-BD",
  "QUERIES BD",
  ".cortex-cache",
]);
