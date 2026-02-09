import fs from "node:fs";
import path from "node:path";
import type { MemoryEntry } from "./types.js";
import { getWorkspaceRoot } from "../config/workspace.js";

const CACHE_DIR = ".cortex-cache";
const CACHE_FILE = "index.json";

export interface CachePayload {
  version: number;
  indexedAt: string;
  repoMTimes: Record<string, number>;
  entries: MemoryEntry[];
}

export function getCachePath(): string {
  const root = getWorkspaceRoot();
  return path.join(root, CACHE_DIR, CACHE_FILE);
}

export function loadFromDisk(): CachePayload | null {
  try {
    const filePath = getCachePath();
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as CachePayload;
    if (!data?.entries || !Array.isArray(data.entries)) return null;
    return {
      version: data.version ?? 1,
      indexedAt: data.indexedAt ?? "",
      repoMTimes: data.repoMTimes && typeof data.repoMTimes === "object" ? data.repoMTimes : {},
      entries: data.entries,
    };
  } catch {
    return null;
  }
}

export function saveToDisk(entries: MemoryEntry[], repoMTimes: Record<string, number>): void {
  try {
    const filePath = getCachePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const payload: CachePayload = {
      version: 1,
      indexedAt: new Date().toISOString(),
      repoMTimes,
      entries,
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 0), "utf-8");
  } catch {
    // ignore write errors (e.g. read-only workspace)
  }
}
