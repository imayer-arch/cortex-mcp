import fs from "node:fs";
import path from "node:path";

/**
 * Map env var (e.g. APPLICATION_SERVICE_HOST) to a likely service repo id.
 * Fully dynamic: no hardcoded repo names; matches by normalizing env to a hint
 * and finding a repo id that contains that hint (or vice versa).
 */
export function envToServiceId(envKey: string, repoIds: string[]): string | null {
  const upper = envKey.toUpperCase();
  if (!upper.endsWith("_HOST") && !upper.endsWith("_URL") && !upper.endsWith("_SERVICE_HOST")) {
    return null;
  }
  const base = upper
    .replace(/_HOST$/, "")
    .replace(/_URL$/, "")
    .replace(/_SERVICE_HOST$/, "")
    .replace(/_/g, "-")
    .toLowerCase();
  if (!base || base.length < 2) return null;

  const baseNorm = base.replace(/-/g, "");
  for (const id of repoIds) {
    const idNorm = id.toLowerCase().replace(/-/g, "");
    if (idNorm.includes(baseNorm) || baseNorm.includes(idNorm)) return id;
  }
  return null;
}

/** Path as literal string or as config key (when path is a variable like this.pathApplications). */
export type PathSpec = { literal: string } | { pathKey: string };

export interface OutboundCall {
  method: string;
  path: PathSpec;
}

export interface OutboundMapping {
  fromRepo: string;
  toService: string;
  envVar: string;
  filePath: string;
  calls: OutboundCall[];
}

const BASE_URL_ENV =
  /createAxiosInstance\s*\(\s*\{[^}]*baseURL\s*:\s*config(?:Service)?\.get\s*\(\s*['"]([^'"]+)['"]\s*\)/s;
const PATH_VAR_TO_KEY = /(?:this\.)?(\w+)\s*=\s*config(?:Service)?\.get\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const AXIOS_METHOD_PATH =
  /(?:axiosInstance|this\.axiosInstance|axios)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const AXIOS_METHOD_PATH_BACKTICK =
  /(?:axiosInstance|this\.axiosInstance|axios)\.(get|post|put|patch|delete)\s*\(\s*`([^`]*)`\s*\)/g;
const AXIOS_METHOD_PATH_VAR =
  /(?:axiosInstance|this\.axiosInstance|axios)\.(get|post|put|patch|delete)\s*\(\s*(?:this\.)?(path\w+)/g;

function extractPathVars(content: string): Map<string, string> {
  const m = new Map<string, string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(PATH_VAR_TO_KEY.source, "g");
  while ((match = re.exec(content)) !== null) {
    m.set(match[1], match[2]);
  }
  return m;
}

function extractCallsFromFile(
  content: string,
  pathVars: Map<string, string>
): OutboundCall[] {
  const calls: OutboundCall[] = [];
  const seen = new Set<string>();

  function add(method: string, pathSpec: PathSpec): void {
    const pathStr = "literal" in pathSpec ? pathSpec.literal : pathSpec.pathKey;
    const key = method + ":" + pathStr;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push({ method, path: pathSpec });
  }

  let m: RegExpExecArray | null;
  const literalRe = new RegExp(AXIOS_METHOD_PATH.source, "g");
  while ((m = literalRe.exec(content)) !== null) {
    const pathStr = m[2].trim();
    if (pathStr.length > 0 && pathStr.length < 300) add(m[1].toUpperCase(), { literal: pathStr });
  }

  const backtickRe = new RegExp(AXIOS_METHOD_PATH_BACKTICK.source, "g");
  while ((m = backtickRe.exec(content)) !== null) {
    const template = m[2].trim();
    const literalPart = template.replace(/\$\{[^}]+\}/g, "").replace(/\/+/g, "/").trim();
    if (literalPart.length > 0 && literalPart.length < 300) add(m[1].toUpperCase(), { literal: literalPart });
  }

  const varRe = new RegExp(AXIOS_METHOD_PATH_VAR.source, "g");
  while ((m = varRe.exec(content)) !== null) {
    const pathVarName = m[2];
    const pathKey = pathVars.get(pathVarName);
    if (pathKey) add(m[1].toUpperCase(), { pathKey });
    else add(m[1].toUpperCase(), { pathKey: pathVarName });
  }

  return calls;
}

/**
 * Scan a repo for outbound HTTP calls: which service (by env) and which (method, path) are called.
 * Works for any workspace: discovers repos from repoIds, infers target service from env var name.
 */
export function extractOutboundMappings(
  repoPath: string,
  repoId: string,
  workspaceRoot: string,
  repoIds: string[]
): OutboundMapping[] {
  const results: OutboundMapping[] = [];
  const srcDir = path.join(repoPath, "src");
  if (!fs.existsSync(srcDir)) return results;

  function scan(dirPath: string): void {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dirPath, e.name);
      if (e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith(".")) {
        scan(full);
        continue;
      }
      if (!e.isFile() || !e.name.endsWith(".ts")) continue;
      try {
        const content = fs.readFileSync(full, "utf-8");
        if (!content.includes("createAxiosInstance") && !content.includes("axiosInstance")) continue;
        const baseUrlMatch = content.match(BASE_URL_ENV);
        if (!baseUrlMatch) continue;
        const envVar = baseUrlMatch[1];
        const toService = envToServiceId(envVar, repoIds);
        if (!toService || toService === repoId) continue;

        const pathVars = extractPathVars(content);
        const calls = extractCallsFromFile(content, pathVars);
        if (calls.length === 0) continue;

        const relPath = path.relative(workspaceRoot, full).replace(/\\/g, "/");
        results.push({
          fromRepo: repoId,
          toService,
          envVar,
          filePath: relPath,
          calls,
        });
      } catch {
        /* ignore */
      }
    }
  }
  scan(srcDir);
  return results;
}
