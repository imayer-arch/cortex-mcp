import fs from "node:fs";
import path from "node:path";
import type { DiscoveredRepo } from "./discovery.js";
import type { RouteInfo } from "./routes.js";

/** Find Kotlin/Java source files that may contain controllers. */
function findControllerFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) results.push(...findControllerFiles(full));
    else if (e.isFile() && (e.name.endsWith(".kt") || e.name.endsWith(".java"))) results.push(full);
  }
  return results;
}

/** Extract path from @RequestMapping or @GetMapping etc. Supports value = "/x" and value = ["/x"]. */
function extractPathFromAnnotation(match: RegExpExecArray): string {
  const full = match[0];
  const valueMatch = full.match(/value\s*=\s*\[?\s*["']([^"']+)["']/);
  if (valueMatch) return valueMatch[1].trim();
  const directMatch = full.match(/["']([^"']+)["']/);
  if (directMatch) return directMatch[1].trim();
  return "";
}

export function extractSpringRoutes(repo: DiscoveredRepo, workspaceRoot: string): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const kotlinDir = path.join(repo.absolutePath, "src", "main", "kotlin");
  const javaDir = path.join(repo.absolutePath, "src", "main", "java");
  const controllerFiles: string[] = [];
  if (fs.existsSync(kotlinDir)) controllerFiles.push(...findControllerFiles(kotlinDir));
  if (fs.existsSync(javaDir)) controllerFiles.push(...findControllerFiles(javaDir));

  const controllerPattern = /@(?:Rest)?Controller(?:\s*\([^)]*\))?/;
  const requestMappingClass = /@RequestMapping\s*\((?:[^)]*value\s*=\s*\[?\s*["']([^"']+)["']|["']([^"']+)["'][^)]*)\)/g;
  const methodMappings = [
    { re: /@GetMapping\s*\((?:[^)]*value\s*=\s*\[?\s*["']([^"']+)["']|["']([^"']+)["'][^)]*)\)/g, method: "GET" },
    { re: /@PostMapping\s*\((?:[^)]*value\s*=\s*\[?\s*["']([^"']+)["']|["']([^"']+)["'][^)]*)\)/g, method: "POST" },
    { re: /@PutMapping\s*\((?:[^)]*value\s*=\s*\[?\s*["']([^"']+)["']|["']([^"']+)["'][^)]*)\)/g, method: "PUT" },
    { re: /@PatchMapping\s*\((?:[^)]*value\s*=\s*\[?\s*["']([^"']+)["']|["']([^"']+)["'][^)]*)\)/g, method: "PATCH" },
    { re: /@DeleteMapping\s*\((?:[^)]*value\s*=\s*\[?\s*["']([^"']+)["']|["']([^"']+)["'][^)]*)\)/g, method: "DELETE" },
  ];

  for (const filePath of controllerFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    if (!controllerPattern.test(content)) continue;

    const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");

    let basePath = "";
    const classMapping = content.match(/@RequestMapping\s*\([^)]+\)/);
    if (classMapping) {
      const vm = classMapping[0].match(/value\s*=\s*\[?\s*["']([^"']+)["']/) ?? classMapping[0].match(/["']([^"']+)["']/);
      if (vm) basePath = vm[1].trim().replace(/^\/+/, "");
    }

    for (const { re, method } of methodMappings) {
      const regex = new RegExp(re.source, "g");
      let m: RegExpExecArray | null;
      while ((m = regex.exec(content)) !== null) {
        const pathPart = (m[1] ?? m[2] ?? "").trim().replace(/^\/+/, "");
        const fullPath = basePath ? (basePath + "/" + pathPart).replace(/\/+/g, "/") : pathPart;
        if (!fullPath) continue;
        const line = content.slice(0, m.index).split("\n").length;
        const after = content.slice(m.index, m.index + 400);
        let requestBodyType: string | undefined;
        const bodyMatch = after.match(/@RequestBody(?:\s*\([^)]*\))?\s*(?:val|var|final)?\s*(\w+)/);
        if (bodyMatch) requestBodyType = bodyMatch[1];
        const genericMatch = after.match(/:\s*(?:ResponseEntity\s*<)?([A-Za-z0-9<>,\s]+?)(?:>)?\s*[{\(]/);
        const responseType = genericMatch ? genericMatch[1].trim() : undefined;
        const funMatch = after.match(/fun\s+(\w+)\s*\(|(\w+)\s*\([^)]*\)\s*(?::|{)/);
        const handlerName = funMatch ? (funMatch[1] ?? funMatch[2]) : undefined;

        routes.push({
          method,
          fullPath: "/" + fullPath.replace(/^\/+/, ""),
          filePath: relPath,
          line,
          requestBodyType,
          responseType,
          handlerName,
        });
      }
    }
  }

  return routes;
}
