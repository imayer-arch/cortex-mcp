import fs from "node:fs";
import path from "node:path";

export interface RouteEndpointInfo {
  path: string;
  routeKey: string;
  componentName: string;
  sourcePath: string;
  /** Endpoints (method + HTTP + path) usados en esta ruta (página + componentes importados). */
  endpoints: { methodName: string; httpMethod: string; pathPattern: string }[];
}

/** Normaliza sourcePath a relativo al repo (sin prefijo repoId/). */
function toRepoRelativeSource(repoId: string, sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, "/").trim();
  const prefix = repoId + "/";
  if (normalized.startsWith(prefix)) return normalized.slice(prefix.length);
  return normalized;
}

function readSafe(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Extrae imports relativos que apuntan a archivos bajo src (ej. ../organisms/X, ../../components/Y).
 * Devuelve paths normalizados repo-relative (src/...).
 */
function extractRelativeImportsToSrc(
  fileContent: string,
  fromDir: string,
  repoPath: string
): string[] {
  const results: string[] = [];
  const re = /import\s+(?:\{[^}]*\}|\w+)\s+from\s+['"](\.\.\/[^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fileContent)) !== null) {
    const importPath = m[1].replace(/\//g, path.sep);
    const resolved = path.normalize(path.join(fromDir, importPath));
    const relToRepo = path.relative(repoPath, resolved).replace(/\\/g, "/");
    if (!relToRepo.startsWith("src/") || relToRepo.startsWith("..")) continue;
    const withExt = /\.(tsx?|jsx?)$/i.test(relToRepo) ? relToRepo : relToRepo + ".tsx";
    if (!results.includes(withExt)) results.push(withExt);
  }
  return results;
}

/**
 * Para cada ruta del front, determina qué endpoints se usan en esa pantalla:
 * la página que define la ruta + los componentes que esa página importa directamente.
 * Usa frontUsages (por sourcePath) y methodToEndpoint para resolver método → HTTP + path.
 * 100% dinámico: no hay rutas ni repos hardcodeados.
 */
export function buildRouteEndpoints(
  repoPath: string,
  repoId: string,
  frontRoutes: { path: string; routeKey: string; componentName: string; sourcePath: string }[],
  frontUsages: { sourcePath: string; serviceName?: string; invokedMethods?: string[] }[],
  methodToEndpoint: Map<string, { httpMethod: string; pathPattern: string }>
): RouteEndpointInfo[] {
  const results: RouteEndpointInfo[] = [];

  for (const fr of frontRoutes) {
    const routeRepoRelative = toRepoRelativeSource(repoId, fr.sourcePath);
    const routeFileAbsolute = path.join(repoPath, routeRepoRelative);

    const sourcePathsForRoute = new Set<string>([routeRepoRelative]);

    const content = readSafe(routeFileAbsolute);
    if (content) {
      const fromDir = path.dirname(routeFileAbsolute);
      const relImports = extractRelativeImportsToSrc(content, fromDir, repoPath);
      for (const rel of relImports) {
        const underSrc = rel.startsWith("src/") ? rel : "src/" + rel.replace(/^src\/?/, "");
        sourcePathsForRoute.add(underSrc);
      }
    }

    const endpointSet = new Map<string, { httpMethod: string; pathPattern: string }>();
    for (const fu of frontUsages) {
      const usageRepoRelative = toRepoRelativeSource(repoId, fu.sourcePath);
      if (!sourcePathsForRoute.has(usageRepoRelative)) continue;
      const methods = fu.invokedMethods ?? [];
      for (const methodName of methods) {
        const ep = methodToEndpoint.get(methodName);
        if (ep && !endpointSet.has(methodName)) {
          endpointSet.set(methodName, { httpMethod: ep.httpMethod, pathPattern: ep.pathPattern });
        }
      }
    }

    const endpoints = [...endpointSet.entries()].map(([methodName, ep]) => ({
      methodName,
      httpMethod: ep.httpMethod,
      pathPattern: ep.pathPattern,
    }));

    results.push({
      path: fr.path,
      routeKey: fr.routeKey,
      componentName: fr.componentName,
      sourcePath: fr.sourcePath,
      endpoints,
    });
  }

  return results;
}
