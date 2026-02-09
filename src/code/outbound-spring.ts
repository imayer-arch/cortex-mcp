import fs from "node:fs";
import path from "node:path";
import { envToServiceId } from "./outbound-calls.js";
import type { OutboundCall, OutboundMapping } from "./outbound-calls.js";

function findKotlinJavaFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) results.push(...findKotlinJavaFiles(full));
    else if (e.isFile() && (e.name.endsWith(".kt") || e.name.endsWith(".java"))) results.push(full);
  }
  return results;
}

/** Normalize Spring config key (e.g. app.application.url) to env-like hint for envToServiceId. */
function configKeyToEnvHint(key: string): string {
  const k = key.replace(/\./g, "_").toUpperCase();
  if (k.endsWith("_URL")) return k;
  if (k.endsWith("_HOST")) return k;
  return k + "_URL";
}

/** Try envToServiceId with key and with last segment (e.g. application.url -> APPLICATION_URL). */
function resolveServiceId(key: string, repoIds: string[]): string | null {
  let s = envToServiceId(configKeyToEnvHint(key), repoIds);
  if (s) return s;
  const parts = key.split(".");
  const last = parts[parts.length - 1];
  if (last && last !== key) s = envToServiceId(last.toUpperCase() + "_URL", repoIds);
  return s ?? null;
}

/** Extract config keys from @Value("${...}") in content. */
function extractValueKeys(content: string): string[] {
  const keys: string[] = [];
  const re = /@Value\s*\(\s*["']\$\{([^}]+)\}\s*["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) keys.push(m[1].trim());
  return keys;
}

/** Find RestTemplate/WebClient base URL config key and extract HTTP calls. */
export function extractOutboundSpringMappings(
  repoPath: string,
  repoId: string,
  workspaceRoot: string,
  repoIds: string[]
): OutboundMapping[] {
  const results: OutboundMapping[] = [];
  const srcDirs = [
    path.join(repoPath, "src", "main", "kotlin"),
    path.join(repoPath, "src", "main", "java"),
  ];
  const files: string[] = [];
  for (const d of srcDirs) {
    if (fs.existsSync(d)) files.push(...findKotlinJavaFiles(d));
  }

  for (const full of files) {
    let content: string;
    try {
      content = fs.readFileSync(full, "utf-8");
    } catch {
      continue;
    }
    if (!content.includes("RestTemplate") && !content.includes("WebClient")) continue;

    const valueKeys = extractValueKeys(content);
    let baseUrlKey: string | null = null;
    let toService: string | null = null;
    for (const key of valueKeys) {
      const lower = key.toLowerCase();
      if (lower.includes("url") || lower.includes("host") || lower.includes("base")) {
        toService = resolveServiceId(key, repoIds);
        if (toService && toService !== repoId) {
          baseUrlKey = key;
          break;
        }
      }
    }
    if (!baseUrlKey || !toService) continue;
    if (!toService || toService === repoId) continue;

    const calls: OutboundCall[] = [];

    const restGet = /\.getForObject\s*\(\s*[^,]+,\s*["']([^"']+)["']/g;
    const restPost = /\.postForEntity\s*\(\s*[^,]+,\s*[^,]+,\s*[^)]*\)/g;
    const restGetUri = /\.getForObject\s*\(\s*(\w+)\s*\+\s*["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = restGet.exec(content)) !== null) {
      const p = m[1].trim();
      if (p.length > 0 && p.length < 300) calls.push({ method: "GET", path: { literal: p } });
    }
    if (calls.length === 0) {
      while ((m = restGetUri.exec(content)) !== null) {
        const p = m[2].trim();
        if (p.length > 0) calls.push({ method: "GET", path: { literal: p } });
      }
    }
    const postForEntityPath = /\.postForEntity\s*\(\s*[^,]*\+\s*["']([^"']+)["']/g;
    while ((m = postForEntityPath.exec(content)) !== null) {
      calls.push({ method: "POST", path: { literal: m[1].trim() } });
    }

    const webClientGet = /\.get\(\)\.uri\s*\(\s*["']([^"']+)["']\s*\)/g;
    const webClientPost = /\.post\(\)\.uri\s*\(\s*["']([^"']+)["']\s*\)/g;
    while ((m = webClientGet.exec(content)) !== null) {
      const p = m[1].trim();
      if (p.length > 0 && p.length < 300) calls.push({ method: "GET", path: { literal: p } });
    }
    while ((m = webClientPost.exec(content)) !== null) {
      const p = m[1].trim();
      if (p.length > 0 && p.length < 300) calls.push({ method: "POST", path: { literal: p } });
    }

    if (calls.length === 0) continue;

    const relPath = path.relative(workspaceRoot, full).replace(/\\/g, "/");
    results.push({
      fromRepo: repoId,
      toService,
      envVar: baseUrlKey,
      filePath: relPath,
      calls,
    });
  }

  return results;
}
