import fs from "node:fs";
import path from "node:path";
import type { DiscoveredRepo } from "./discovery.js";

const CONTROLLER_DECOR = /@Controller\(\s*['"`]?([^'"`)]*)['"`]?\s*\)/;
const METHOD_DECOR = /@(Get|Post|Put|Patch|Delete)\(\s*['"`]([^'"`]+)['"`]\s*\)/g;

export interface RouteInfo {
  method: string;
  fullPath: string;
  filePath: string;
  line?: number;
  requestBodyType?: string;
  responseType?: string;
  handlerName?: string;
}

function findControllerFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) results.push(...findControllerFiles(full));
    else if (e.isFile() && e.name.endsWith(".controller.ts")) results.push(full);
  }
  return results;
}

export function extractNestRoutes(repo: DiscoveredRepo, workspaceRoot: string): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const controllersDir = path.join(repo.absolutePath, repo.controllersPath);
  const controllerFiles = findControllerFiles(controllersDir);

  for (const filePath of controllerFiles) {
    const content = fs.readFileSync(filePath, "utf-8");
    const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
    const basePathMatch = content.match(CONTROLLER_DECOR);
    const basePath = basePathMatch ? (basePathMatch[1] || "").trim() : "";

    let m: RegExpExecArray | null;
    const methodRegex = new RegExp(METHOD_DECOR.source, "g");
    while ((m = methodRegex.exec(content)) !== null) {
      const method = m[1].toUpperCase();
      const routePath = m[2].trim();
      const fullPath = basePath
        ? (basePath.endsWith("/") ? basePath + routePath : basePath + "/" + routePath)
        : routePath;
      const pos = m.index;
      const after = content.slice(pos, pos + 800);
      const line = content.slice(0, pos).split("\n").length;

      let requestBodyType: string | undefined;
      let responseType: string | undefined;
      let handlerName: string | undefined;
      const bodyMatch = after.match(/@Body\(\)[^:]*:\s*(\w+)/);
      if (bodyMatch) requestBodyType = bodyMatch[1];
      const returnMatch = after.match(/\)\s*:\s*Promise\s*<\s*([^>]+)\s*>/);
      if (returnMatch) responseType = returnMatch[1].trim();
      const handlerMatch = after.match(/(?:async\s+)?(\w+)\s*\(/);
      if (handlerMatch) handlerName = handlerMatch[1];

      routes.push({
        method,
        fullPath,
        filePath: relPath,
        line,
        requestBodyType,
        responseType,
        handlerName,
      });
    }
  }

  return routes;
}
