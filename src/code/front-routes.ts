import fs from "node:fs";
import path from "node:path";

export interface FrontRouteInfo {
  path: string;
  routeKey: string;
  componentName: string;
  sourcePath: string;
}

const ROUTE_PATHS_FILES = ["src/routes/routePaths.ts", "src/routes/routePaths.js"];
const ROUTES_FILES = ["src/routes/Routes.tsx", "src/routes/Routes.jsx", "src/routes/index.tsx"];

function readSafe(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/** Extrae key -> path desde routePaths (export const routes = { key: '/path', ... }). */
function extractPathMap(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /(\w+):\s*['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

/** Extrae (routeKey, componentName) desde Routes: path: routes.KEY, element: withLayout(Component). */
function extractRouteComponents(content: string): Array<{ routeKey: string; componentName: string }> {
  const pairs: Array<{ routeKey: string; componentName: string }> = [];
  const blockRe = /\{\s*path:\s*routes\.(\w+)[^}]*?withLayout\s*\(\s*(\w+)\s*\)/gs;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(content)) !== null) {
    pairs.push({ routeKey: m[1], componentName: m[2] });
  }
  return pairs;
}

/** Extrae import Component from 'path' para mapear Component -> archivo relativo (src/...). */
function extractComponentImports(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /import\s+(\w+)\s+from\s+['"](\.\.\/[^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const rel = m[2].replace(/^\.\.\//, "").replace(/\//g, path.sep);
    const full = rel.startsWith("src") ? rel : path.join("src", rel);
    const normalized = full.replace(/\.(tsx?|jsx?)$/, "");
    map.set(m[1], (normalized + ".tsx").replace(/\\/g, "/"));
  }
  return map;
}

export function extractFrontRoutes(repoPath: string, workspaceRoot: string): FrontRouteInfo[] {
  const results: FrontRouteInfo[] = [];
  let pathMap = new Map<string, string>();
  let routePathContent: string | null = null;

  for (const rel of ROUTE_PATHS_FILES) {
    const full = path.join(repoPath, rel);
    routePathContent = readSafe(full);
    if (routePathContent) {
      pathMap = extractPathMap(routePathContent);
      break;
    }
  }
  if (pathMap.size === 0) return results;

  let routesContent: string | null = null;
  for (const rel of ROUTES_FILES) {
    const full = path.join(repoPath, rel);
    routesContent = readSafe(full);
    if (routesContent) break;
  }
  if (!routesContent) return results;

  const pairs = extractRouteComponents(routesContent);
  const componentToFile = extractComponentImports(routesContent);

  for (const { routeKey, componentName } of pairs) {
    const routePath = pathMap.get(routeKey);
    if (!routePath) continue;
    const sourcePath = componentToFile.get(componentName) ?? `src/pages/${componentName}.tsx`;
    const relPath = path.relative(workspaceRoot, path.join(repoPath, sourcePath)).replace(/\\/g, "/");
    results.push({
      path: routePath,
      routeKey,
      componentName,
      sourcePath: relPath.startsWith("..") ? sourcePath : relPath,
    });
  }
  return results;
}
