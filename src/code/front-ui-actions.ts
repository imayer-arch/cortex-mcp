import fs from "node:fs";
import path from "node:path";

export interface UiActionEntry {
  sourcePath: string;
  /** Label visible (botón, primaryText, etc.) */
  label: string;
  /** Nombre del handler (handleApprove, handleApplication, etc.) */
  handlerName: string;
  /** Métodos de servicio que se invocan (directa o indirectamente) al ejecutar este handler */
  methodNames: string[];
  httpMethod?: string;
  pathPattern?: string;
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

/** Extrae definiciones de handlers: const handleX = (...) => { ... } o function handleX(...) { ... } */
function extractHandlerDefinitions(content: string): { name: string; body: string }[] {
  const result: { name: string; body: string }[] = [];

  // const handleX = ( ... ) => { ... }  (arrow)
  const arrowRe = /const\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^(]\w*)\s*=>\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = arrowRe.exec(content)) !== null) {
    const name = m[1];
    const start = m.index + m[0].length - 1;
    let depth = 1;
    let i = start;
    while (i < content.length && depth > 0) {
      const c = content[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    const body = content.slice(start + 1, i - 1);
    result.push({ name, body });
  }

  // function handleX( ... ) { ... }
  const funcRe = /function\s+(\w+)\s*\([^)]*\)\s*\{/g;
  while ((m = funcRe.exec(content)) !== null) {
    const name = m[1];
    const start = m.index + m[0].length - 1;
    let depth = 1;
    let i = start;
    while (i < content.length && depth > 0) {
      const c = content[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    const body = content.slice(start + 1, i - 1);
    if (!result.some((r) => r.name === name)) result.push({ name, body });
  }

  return result;
}

/** En el cuerpo de un handler, encuentra llamadas a otros handlers: handleY() o handleY(...) */
function findHandlerCallsInBody(body: string, knownHandlers: Set<string>): string[] {
  const called: string[] = [];
  for (const h of knownHandlers) {
    const re = new RegExp("\\b" + h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\(", "g");
    if (re.test(body)) called.push(h);
  }
  return called;
}

/** En el cuerpo, encuentra llamadas a métodos de servicio (de la lista methodNames). */
function findServiceMethodCallsInBody(body: string, methodNames: Set<string>): string[] {
  const called: string[] = [];
  for (const method of methodNames) {
    const re = new RegExp("\\b" + method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\(", "g");
    if (re.test(body)) called.push(method);
  }
  return called;
}

/** Resuelve transitivamente: cada handler → set de métodos de servicio que termina llamando. */
function resolveHandlersToMethods(
  handlers: { name: string; body: string }[],
  allServiceMethodNames: Set<string>
): Map<string, Set<string>> {
  const handlerNames = new Set(handlers.map((h) => h.name));
  const byName = new Map(handlers.map((h) => [h.name, h.body]));

  const result = new Map<string, Set<string>>();

  function collect(handlerName: string): Set<string> {
    const cached = result.get(handlerName);
    if (cached) return cached;
    const body = byName.get(handlerName);
    const methods = new Set<string>();
    result.set(handlerName, methods);

    if (!body) return methods;

    const directMethods = findServiceMethodCallsInBody(body, allServiceMethodNames);
    directMethods.forEach((m) => methods.add(m));

    const calledHandlers = findHandlerCallsInBody(body, handlerNames);
    for (const h of calledHandlers) {
      if (h !== handlerName) {
        collect(h).forEach((m) => methods.add(m));
      }
    }
    return methods;
  }

  for (const { name } of handlers) {
    collect(name);
  }
  return result;
}

/** Extrae pares (label, handlerName) de JSX: Button onClick, Modal primaryText/onPrimaryAction, etc. */
function extractUiBindings(content: string): { label: string; handlerName: string }[] {
  const pairs: { label: string; handlerName: string }[] = [];

  // Modal: primaryText='...' ... onPrimaryAction={...} — captura handleX() dentro del bloque o () => handleX()
  const modalPrimaryRe = /primaryText\s*=\s*['"]([^'"]+)['"][\s\S]*?onPrimaryAction\s*=\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = modalPrimaryRe.exec(content)) !== null) {
    const label = m[1].trim();
    const block = m[2];
    const direct = block.match(/\(\s*\)\s*=>\s*(\w+)\(\)/);
    const inBlock = block.match(/\b(handle\w+)\(\)/);
    const handler = direct?.[1] ?? inBlock?.[1];
    if (label && handler) pairs.push({ label, handlerName: handler });
  }

  const modalSecondaryRe = /secondaryText\s*=\s*['"]([^'"]+)['"][\s\S]*?onSecondaryAction\s*=\s*\{([^}]+)\}/g;
  while ((m = modalSecondaryRe.exec(content)) !== null) {
    const label = m[1].trim();
    const block = m[2];
    const inBlock = block.match(/\b(handle\w+)\(\)/);
    const handler = inBlock?.[1];
    if (label && handler) pairs.push({ label, handlerName: handler });
  }

  // Button: onClick={handleX} o onClick={() => handleX()} ... > 'Label' o "Label"
  const buttonRe = /<Button[^>]*onClick\s*=\s*\{\s*(?:\([^)]*\)\s*=>\s*(\w+)\(\)|(\w+))[^>]*>[\s\n]*(?:['"]([^'"]+)['"])/g;
  while ((m = buttonRe.exec(content)) !== null) {
    const handler = m[1] || m[2];
    const label = (m[3] ?? "").trim();
    if (handler && label) pairs.push({ label, handlerName: handler });
  }

  // Button con orden inverso: > 'Label' ... onClick
  const buttonRe2 = /<Button[^>]*>[\s\n]*['"]([^'"]+)['"][\s\S]*?onClick\s*=\s*\{\s*(?:\([^)]*\)\s*=>\s*(\w+)\(\)|(\w+))/g;
  while ((m = buttonRe2.exec(content)) !== null) {
    const label = m[1].trim();
    const handler = m[2] || m[3];
    if (label && handler) pairs.push({ label, handlerName: handler });
  }

  return pairs;
}

/**
 * Extrae por cada archivo front las acciones de UI (botón/modal + label) y los métodos de servicio
 * que se invocan al ejecutar ese handler (directa o indirectamente).
 */
export function extractUiActions(
  repoPath: string,
  workspaceRoot: string,
  allServiceMethodNames: Set<string>,
  methodToEndpoint?: Map<string, { httpMethod: string; pathPattern: string }>
): UiActionEntry[] {
  const results: UiActionEntry[] = [];
  const srcDir = path.join(repoPath, "src");
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) return results;

  const files = findTsTsxFiles(srcDir);
  for (const filePath of files) {
    const content = readSafe(filePath);
    if (!content) continue;

    const handlers = extractHandlerDefinitions(content);
    const handlerToMethods = resolveHandlersToMethods(handlers, allServiceMethodNames);
    const bindings = extractUiBindings(content);

    const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
    const sourcePath = relPath.startsWith("..") ? path.relative(repoPath, filePath).replace(/\\/g, "/") : relPath;

    for (const { label, handlerName } of bindings) {
      const methodNames = [...(handlerToMethods.get(handlerName) ?? [])];
      if (methodNames.length === 0) continue;

      const firstMethod = methodNames[0];
      const endpoint = methodToEndpoint?.get(firstMethod);

      results.push({
        sourcePath,
        label: label.slice(0, 120),
        handlerName,
        methodNames,
        httpMethod: endpoint?.httpMethod,
        pathPattern: endpoint?.pathPattern,
      });
    }
  }
  return results;
}
