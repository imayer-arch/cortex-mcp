/**
 * Extrae interfaces y tipos exportados de archivos TS/TSX del front
 * para indexarlos como response_schema (generación de examples en OpenAPI).
 */

import fs from "node:fs";
import path from "node:path";

export interface ResponseSchemaInfo {
  typeName: string;
  properties: { name: string; type: string }[];
  sourcePath: string;
  line?: number;
}

const TS_EXT = [".ts", ".tsx"];
const FRONT_SCOPED_DIRS = ["src/services", "src/types", "src/api", "src/models"];

function readSafe(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/** Encuentra el bloque de cuerpo { ... } que empieza en startIndex. Retorna end index (inclusive) o -1. */
function findMatchingBrace(content: string, startIndex: number): number {
  if (content[startIndex] !== "{") return -1;
  let depth = 1;
  let i = startIndex + 1;
  const len = content.length;
  while (i < len && depth > 0) {
    const c = content[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if ((c === '"' || c === "'" || c === "`") && content[i - 1] !== "\\") {
      const quote = c;
      i++;
      while (i < len && (content[i] !== quote || content[i - 1] === "\\")) i++;
    }
    i++;
  }
  return depth === 0 ? i - 1 : -1;
}

/** Extrae propiedades desde un string de bloque (entre { y }), solo primer nivel. */
function extractPropertiesFromBlock(block: string): { name: string; type: string }[] {
  const props: { name: string; type: string }[] = [];
  let depth = 0;
  const lines = block.split("\n");
  for (const line of lines) {
    if (depth > 0) {
      for (const c of line) {
        if (c === "{") depth++;
        else if (c === "}") depth--;
      }
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    const match = trimmed.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\??\s*:\s*(.+)$/);
    if (match) {
      const [, name, typePart] = match;
      let typeStr = typePart.trim();
      if (typeStr.endsWith(";")) typeStr = typeStr.slice(0, -1).trim();
      if (typeStr.startsWith("{")) typeStr = "object";
      else if (typeStr.includes("{")) typeStr = typeStr.split("{")[0].trim() || "object";
      if (typeStr.endsWith("[]")) typeStr = typeStr.slice(0, -2);
      props.push({ name, type: typeStr.replace(/\s+/g, " ") });
    }
    for (const c of line) {
      if (c === "{") depth++;
      else if (c === "}") depth--;
    }
  }
  return props;
}

/**
 * Extrae de un archivo TS/TSX todas las export interface X { ... } y export type X = { ... }
 * con propiedades de primer nivel (name, type).
 */
function extractFromContent(content: string, filePath: string): ResponseSchemaInfo[] {
  const results: ResponseSchemaInfo[] = [];
  const relPath = filePath;

  // export interface Name { ... }
  const ifaceRe = /export\s+interface\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = ifaceRe.exec(content)) !== null) {
    const typeName = m[1];
    const start = m.index + m[0].length - 1;
    const end = findMatchingBrace(content, start);
    if (end === -1) continue;
    const block = content.slice(start + 1, end);
    const line = content.slice(0, m.index).split("\n").length;
    const properties = extractPropertiesFromBlock(block);
    results.push({ typeName, properties, sourcePath: relPath, line });
  }

  // export type Name = { ... };
  const typeRe = /export\s+type\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*\{/g;
  while ((m = typeRe.exec(content)) !== null) {
    const typeName = m[1];
    const start = m.index + m[0].length - 1;
    const end = findMatchingBrace(content, start);
    if (end === -1) continue;
    const block = content.slice(start + 1, end);
    const line = content.slice(0, m.index).split("\n").length;
    const properties = extractPropertiesFromBlock(block);
    results.push({ typeName, properties, sourcePath: relPath, line });
  }

  return results;
}

function* walkTsFiles(dir: string, baseDir: string): Generator<string> {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(baseDir, full);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
        yield* walkTsFiles(full, baseDir);
      } else if (TS_EXT.includes(path.extname(e.name))) {
        yield rel;
      }
    }
  } catch {
    // ignore
  }
}

/**
 * Extrae response_schema (interfaces y tipos con propiedades) de un repo front/other.
 * Escanea src/services, src/types, src/api, src/models y cualquier .ts/.tsx en src que pueda tener tipos.
 */
export function extractResponseSchemas(repoAbsolutePath: string, workspaceRoot: string): ResponseSchemaInfo[] {
  const results: ResponseSchemaInfo[] = [];
  const baseDir = path.join(repoAbsolutePath, "src");
  if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) return results;

  const dirsToScan = FRONT_SCOPED_DIRS.map((d) => path.join(repoAbsolutePath, d)).filter((d) => fs.existsSync(d));
  if (dirsToScan.length === 0) {
    dirsToScan.push(baseDir);
  }

  const seen = new Set<string>();
  for (const dir of dirsToScan) {
    for (const rel of walkTsFiles(dir, repoAbsolutePath)) {
      const fullPath = path.join(repoAbsolutePath, rel);
      const key = path.normalize(fullPath);
      if (seen.has(key)) continue;
      seen.add(key);
      const content = readSafe(fullPath);
      if (!content) continue;
      const relToWorkspace = path.relative(workspaceRoot, fullPath);
      for (const schema of extractFromContent(content, relToWorkspace)) {
        results.push(schema);
      }
    }
  }

  return results;
}
