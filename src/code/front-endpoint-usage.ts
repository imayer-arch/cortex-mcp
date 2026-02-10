import fs from "node:fs";
import path from "node:path";

export interface FrontEndpointUsage {
  sourcePath: string;
  serviceName?: string;
  pathFragment?: string;
  urlLiteral?: string;
  /** Nombres de métodos del servicio que este archivo invoca (ej. getApplication, getDebts). */
  invokedMethods?: string[];
}

function readSafe(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function findTsTsxFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith(".")) {
      results.push(...findTsTsxFiles(full));
    } else if (e.isFile() && (e.name.endsWith(".tsx") || e.name.endsWith(".ts"))) {
      results.push(full);
    }
  }
  return results;
}

/** Detecta import from '.../services/X' o '.../XService'. */
function extractServiceImports(content: string): string[] {
  const names = new Set<string>();
  const re = /import\s+(?:\{[^}]*\}|\w+)\s+from\s+['"][^'"]*\/services\/([^'"/]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    names.add(m[1].replace(/\.(tsx?|jsx?)$/, ""));
  }
  return [...names];
}

/** Detecta URLs de API en el código: '/v1/private/...' o `...bureau-calls...`. */
function extractApiPathFragments(content: string): string[] {
  const fragments = new Set<string>();
  const urlRe = /['"`](\/v1\/private\/[^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(content)) !== null) {
    const p = m[1].split("?")[0];
    const parts = p.split("/").filter(Boolean);
    if (parts.length >= 3) fragments.add(parts[parts.length - 1] ?? p);
  }
  return [...fragments];
}

/** Detecta invocaciones a métodos en el contenido (ej. getApplication(, getDebts(). */
function findInvokedMethodsInContent(content: string, methodNames: Set<string>): string[] {
  const invoked: string[] = [];
  for (const method of methodNames) {
    const re = new RegExp("\\b" + method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\(", "g");
    if (re.test(content)) invoked.push(method);
  }
  return invoked;
}

/**
 * @param serviceToMethods Si se pasa (serviceName -> set de methodNames), se agrega invokedMethods por servicio.
 */
export function extractFrontEndpointUsage(
  repoPath: string,
  workspaceRoot: string,
  serviceToMethods?: Map<string, Set<string>>
): FrontEndpointUsage[] {
  const results: FrontEndpointUsage[] = [];
  const srcDir = path.join(repoPath, "src");
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) return results;

  const files = findTsTsxFiles(srcDir);
  for (const filePath of files) {
    const content = readSafe(filePath);
    if (!content) continue;
    const services = extractServiceImports(content);
    const pathFragments = extractApiPathFragments(content);
    if (services.length === 0 && pathFragments.length === 0) continue;

    const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
    const sourcePath = relPath.startsWith("..") ? path.relative(repoPath, filePath).replace(/\\/g, "/") : relPath;

    for (const serviceName of services) {
      const methodsForService = serviceToMethods?.get(serviceName);
      const invokedMethods =
        methodsForService && methodsForService.size > 0
          ? findInvokedMethodsInContent(content, methodsForService)
          : undefined;
      results.push({
        sourcePath,
        serviceName,
        invokedMethods: invokedMethods?.length ? invokedMethods : undefined,
      });
    }
    for (const pathFragment of pathFragments) {
      if (!results.some((r) => r.sourcePath === sourcePath && r.pathFragment === pathFragment)) {
        results.push({ sourcePath, pathFragment });
      }
    }
  }
  return results;
}
