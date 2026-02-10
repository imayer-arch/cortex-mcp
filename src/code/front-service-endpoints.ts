import fs from "node:fs";
import path from "node:path";

export interface ServiceEndpointInfo {
  serviceName: string;
  methodName: string;
  httpMethod: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pathPattern: string;
  sourcePath: string;
  /** Nombres de parámetros (ej. ["cuit", "id"]) para búsqueda y documentación. */
  paramNames?: string[];
}

function readSafe(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/** Extrae apiUrls = { key: 'value', ... } del contenido. */
function extractApiUrls(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /(?:const|let)\s+apiUrls\s*=\s*\{([^}]+)\}/s;
  const m = content.match(re);
  if (!m) return map;
  const block = m[1];
  const pairRe = /(\w+):\s*['"`]([^'"`]+)['"`]/g;
  let pm: RegExpExecArray | null;
  while ((pm = pairRe.exec(block)) !== null) {
    map.set(pm[1], pm[2].trim());
  }
  return map;
}

/** Convierte expresión de URL (apiUrls.xxx + var + '/path') en patrón /base/:var/path. Literales de path no se convierten en :v1/:private/. */
function urlExpressionToPattern(expr: string, apiUrls: Map<string, string>): string {
  let s = expr.trim();
  const singleMatch = s.match(/^apiUrls\.(\w+)$/);
  if (singleMatch) {
    const val = apiUrls.get(singleMatch[1]);
    return normalizePathPattern(val ? val.replace(/\?.*$/, "").trim() : "/");
  }
  apiUrls.forEach((value, key) => {
    const re = new RegExp(`apiUrls\\.${key}\\s*\\+?\\s*`, "g");
    s = s.replace(re, value);
  });
  const parts: string[] = [];
  const segments = s.split(/\s*\+\s*/).map((t) => t.trim());
  for (const seg of segments) {
    if (!seg) continue;
    const quoted = seg.match(/^['"`]([^'"`]*)['"`]$/);
    if (quoted) {
      const literal = quoted[1].replace(/^\//, "").replace(/\/$/, "").split("?")[0];
      if (literal) parts.push(literal);
      continue;
    }
    if (/^\/[^+]*\/?$/.test(seg)) {
      const literal = seg.replace(/^\//, "").replace(/\/$/, "").split("?")[0];
      if (literal) parts.push(literal);
      continue;
    }
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(seg) && !/^(undefined|null|apiUrls)$/.test(seg) && !/^\d+$/.test(seg)) {
      parts.push(":" + seg);
    }
  }
  const joined = "/" + parts.join("/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
  return normalizePathPattern(joined || "/");
}

/** Evita :v1/:private/ etc.: segmentos que son literales de path típicos se dejan como literales. */
function normalizePathPattern(p: string): string {
  if (!p || p === "/") return p;
  const segments = p.split("/").filter(Boolean);
  const out: string[] = [];
  const pathLiterals = new Set(["v1", "private", "public", "applications", "clients", "application", "dashboard", "stats", "templates", "annexes", "contracts", "guarantees"]);
  for (const seg of segments) {
    if (seg.startsWith(":")) {
      const name = seg.slice(1);
      if (pathLiterals.has(name)) out.push(name);
      else out.push(seg);
    } else {
      out.push(seg);
    }
  }
  return "/" + out.join("/");
}

/** Detecta método HTTP por nombre de función secureGet, securePost, etc. */
function detectHttpMethod(body: string): "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | null {
  if (/\bsecureGet\s*\(/.test(body)) return "GET";
  if (/\bsecurePost\s*\(/.test(body)) return "POST";
  if (/\bsecurePut\s*\(/.test(body)) return "PUT";
  if (/\bsecurePatch\s*\(/.test(body)) return "PATCH";
  if (/\bsecureDelete\s*\(/.test(body)) return "DELETE";
  if (/\baxios\.get\s*\(/.test(body)) return "GET";
  if (/\baxios\.post\s*\(/.test(body)) return "POST";
  if (/\baxios\.put\s*\(/.test(body)) return "PUT";
  if (/\baxios\.patch\s*\(/.test(body)) return "PATCH";
  if (/\baxios\.delete\s*\(/.test(body)) return "DELETE";
  return null;
}

/** Extrae la expresión de URL del cuerpo de la función (const url = ... o return secureX(url)). */
function extractUrlExpression(body: string): string | null {
  const constMatch = body.match(/(?:const|let)\s+url\s*=\s*([^;]+);/s);
  if (constMatch) return constMatch[1].trim();
  const templateMatch = body.match(/url\s*\+=\s*`[^`]*`/);
  if (templateMatch) {
    const literalMatch = body.match(/['"`](\/v1\/[^'"`]*)['"`]/);
    return literalMatch ? literalMatch[1] : null;
  }
  const inlineMatch = body.match(/return\s+secure(?:Get|Post|Put|Patch|Delete)\s*\(\s*([^,)]+)\s*\)/s);
  if (inlineMatch) return inlineMatch[1].trim();
  const inlineMatch2 = body.match(/secure(?:Get|Post|Put|Patch|Delete)\s*\(\s*([^,)]+)\s*[,)]/s);
  if (inlineMatch2) return inlineMatch2[1].trim();
  return null;
}

/** Extrae nombres de parámetros del primer (...) en el bloque (ej. (cuit: string, id: string) => ). */
function extractParamNames(block: string): string[] {
  const match = block.match(/\(([^)]*)\)\s*(?:=>|\{)/);
  if (!match || !match[1].trim()) return [];
  return match[1].split(",").map((p) => p.trim().split(/[\s:]/)[0]).filter(Boolean);
}

/** Trocea el archivo por bloques que empiezan con export const X = async o export async function X. */
function splitExportedFunctions(content: string): { name: string; body: string; paramNames: string[] }[] {
  const funcs: { name: string; body: string; paramNames: string[] }[] = [];
  const blocks = content.split(/(?=\bexport\s+(?:const\s+\w+\s*=\s*async|async\s+function\s+\w+))/);
  for (const block of blocks) {
    const nameMatch = block.match(/export\s+(?:const\s+(\w+)\s*=\s*async|async\s+function\s+(\w+))/);
    if (!nameMatch) continue;
    const name = nameMatch[1] ?? nameMatch[2];
    const braceStart = block.indexOf("{");
    if (braceStart === -1) continue;
    let depth = 1;
    let i = braceStart + 1;
    while (i < block.length && depth > 0) {
      const c = block[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    const body = block.slice(braceStart + 1, i - 1);
    const paramNames = extractParamNames(block);
    funcs.push({ name, body, paramNames });
  }
  return funcs;
}

/**
 * Extrae de un archivo de servicio (ApplicationService, RiskService, etc.) los métodos
 * exportados y el endpoint (método HTTP + path pattern) que cada uno usa.
 */
export function extractServiceEndpoints(
  repoPath: string,
  workspaceRoot: string
): ServiceEndpointInfo[] {
  const results: ServiceEndpointInfo[] = [];
  const servicesDir = path.join(repoPath, "src", "services");
  if (!fs.existsSync(servicesDir) || !fs.statSync(servicesDir).isDirectory()) return results;

  const files = fs.readdirSync(servicesDir, { withFileTypes: true });
  for (const e of files) {
    if (!e.isFile() || (!e.name.endsWith(".ts") && !e.name.endsWith(".tsx"))) continue;
    const filePath = path.join(servicesDir, e.name);
    const content = readSafe(filePath);
    if (!content) continue;

    const serviceName = e.name.replace(/\.(tsx?|jsx?)$/, "");
    const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
    const sourcePath = relPath.startsWith("..") ? path.relative(repoPath, filePath).replace(/\\/g, "/") : relPath;

    const apiUrls = extractApiUrls(content);
    const funcs = splitExportedFunctions(content);

    for (const { name, body, paramNames } of funcs) {
      const httpMethod = detectHttpMethod(body);
      if (!httpMethod) continue;
      const urlExpr = extractUrlExpression(body);
      let pathPattern: string;
      if (urlExpr) {
        if (urlExpr.startsWith("'") || urlExpr.startsWith('"') || urlExpr.startsWith("`")) {
          pathPattern = normalizePathPattern(urlExpr.replace(/^['"`]|['"`]$/g, "").split("?")[0].trim());
        } else {
          pathPattern = urlExpressionToPattern(urlExpr, apiUrls);
        }
      } else {
        pathPattern = "/";
      }
      if (!pathPattern || pathPattern === "/") continue;
      results.push({
        serviceName,
        methodName: name,
        httpMethod,
        pathPattern,
        sourcePath,
        paramNames: paramNames.length ? paramNames : undefined,
      });
    }
  }
  return results;
}
