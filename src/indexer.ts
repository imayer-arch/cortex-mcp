import fs from "node:fs";
import path from "node:path";
import { getWorkspaceRoot } from "./config/workspace.js";
import { EXCLUDE_DIRS } from "./config/workspace.js";
import type { MemoryEntry } from "./memory/types.js";
import { setMemory } from "./memory/store.js";
import { loadFromDisk, saveToDisk } from "./memory/persistence.js";
import { computeEmbeddingsForEntries } from "./embeddings.js";
import { indexCode } from "./code/indexer.js";
import { discoverRepos } from "./code/discovery.js";

const MAX_FILE_BYTES = 500 * 1024; // 500 KB por doc
const MAX_DOC_ENTRIES_PER_REPO = 100; // límite por repo para docs/ADRs
const CORTEX_DEBUG = process.env.CORTEX_DEBUG === "1" || process.env.CORTEX_DEBUG === "true";

function readFileSafe(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function extractTitleFromMarkdown(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function extractTagsFromContent(content: string): string[] {
  const tags: string[] = [];
  const tagLine = content.match(/^tags?:\s*(.+)$/im);
  if (tagLine) {
    tagLine[1].split(/[\s,]+/).forEach((t) => {
      const cleaned = t.replace(/^#/, "").trim();
      if (cleaned) tags.push(cleaned);
    });
  }
  const adrMatch = content.match(/^#\s*ADR[- ]?(\d+)/im);
  if (adrMatch) tags.push(`ADR-${adrMatch[1]}`);
  return tags;
}

function extractReferences(content: string): string[] {
  const refs: string[] = [];
  const adrRefs = content.match(/ADR[- ]?\d+/gi);
  if (adrRefs) refs.push(...[...new Set(adrRefs)].map((r) => r.toUpperCase().replace(/\s/g, "-")));
  const ticketRefs = content.match(/#\d+/g);
  if (ticketRefs) refs.push(...[...new Set(ticketRefs)]);
  return refs;
}

function slugId(source: string, relativePath: string): string {
  return `${source}:${relativePath.replace(/\//g, ":")}`.slice(0, 120);
}

/**
 * Escanea el workspace y construye la memoria de CORTEX.
 * Indexa: README.md por repo, docs/*.md, ADR*.md, docs/adr/*.md
 */
export function indexWorkspace(workspaceRoot: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];

  if (!fs.existsSync(workspaceRoot)) return entries;

  const dirs = fs.readdirSync(workspaceRoot, { withFileTypes: true });
  const repoDirs = dirs.filter((d) => d.isDirectory() && !d.name.startsWith(".") && !EXCLUDE_DIRS.has(d.name));

  for (const repo of repoDirs) {
    const repoPath = path.join(workspaceRoot, repo.name);
    const source = repo.name;
    let repoDocCount = 0;

    // README en la raíz del repo
    const readmePath = path.join(repoPath, "README.md");
    if (fs.existsSync(readmePath) && repoDocCount < MAX_DOC_ENTRIES_PER_REPO) {
      const content = readFileSafe(readmePath);
      if (content) {
        const title = extractTitleFromMarkdown(content) || `${source} — README`;
        const relPath = path.relative(workspaceRoot, readmePath);
        entries.push({
          id: slugId(source, "README.md"),
          kind: "readme",
          source,
          sourcePath: relPath,
          title,
          content: content.slice(0, 8000),
          fullContent: content.length < 15000 ? content : undefined,
          tags: extractTagsFromContent(content),
          references: extractReferences(content),
        });
        repoDocCount++;
      }
    }

    // docs/*.md
    const docsPath = path.join(repoPath, "docs");
    if (fs.existsSync(docsPath) && fs.statSync(docsPath).isDirectory() && repoDocCount < MAX_DOC_ENTRIES_PER_REPO) {
      const docFiles = fs.readdirSync(docsPath, { withFileTypes: true });
      for (const f of docFiles) {
        if (repoDocCount >= MAX_DOC_ENTRIES_PER_REPO) break;
        if (!f.isFile() || !f.name.endsWith(".md")) continue;
        const fullPath = path.join(docsPath, f.name);
        const content = readFileSafe(fullPath);
        if (!content) continue;
        const title = extractTitleFromMarkdown(content) || f.name.replace(".md", "");
        const relPath = path.relative(workspaceRoot, fullPath);
        const kind = /adr|decision|post[- ]?mortem/i.test(f.name) ? "adr" : "doc";
        entries.push({
          id: slugId(source, relPath),
          kind: kind === "adr" ? "adr" : "doc",
          source,
          sourcePath: relPath,
          title,
          content: content.slice(0, 8000),
          fullContent: content.length < 15000 ? content : undefined,
          tags: extractTagsFromContent(content),
          references: extractReferences(content),
        });
        repoDocCount++;
      }
    }

    // ADR*.md en la raíz o en docs/adr
    const adrRoot = path.join(repoPath, "docs", "adr");
    const adrDirs = [repoPath, adrRoot];
    for (const adrDir of adrDirs) {
      if (repoDocCount >= MAX_DOC_ENTRIES_PER_REPO) break;
      if (!fs.existsSync(adrDir) || !fs.statSync(adrDir).isDirectory()) continue;
      const files = fs.readdirSync(adrDir, { withFileTypes: true });
      for (const f of files) {
        if (repoDocCount >= MAX_DOC_ENTRIES_PER_REPO) break;
        if (!f.isFile() || !f.name.endsWith(".md")) continue;
        if (adrDir === repoPath && !/^ADR/i.test(f.name)) continue;
        const fullPath = path.join(adrDir, f.name);
        const content = readFileSafe(fullPath);
        if (!content) continue;
        const title = extractTitleFromMarkdown(content) || f.name.replace(".md", "");
        const relPath = path.relative(workspaceRoot, fullPath);
        entries.push({
          id: slugId(source, relPath),
          kind: "adr",
          source,
          sourcePath: relPath,
          title,
          content: content.slice(0, 8000),
          fullContent: content.length < 15000 ? content : undefined,
          tags: extractTagsFromContent(content),
          references: extractReferences(content),
        });
        repoDocCount++;
      }
    }
  }
  if (CORTEX_DEBUG) console.debug("[CORTEX] indexWorkspace entries:", entries.length);

  return entries;
}

export async function refreshMemory(forceFull = false): Promise<MemoryEntry[]> {
  const root = getWorkspaceRoot();
  const repos = discoverRepos(root);
  const repoMTimes: Record<string, number> = {};
  for (const r of repos) {
    try {
      repoMTimes[r.id] = fs.statSync(r.absolutePath).mtimeMs;
    } catch {
      /* ignore */
    }
  }

  if (!forceFull) {
    const cached = loadFromDisk();
    if (cached?.entries?.length) {
      const curKeys = Object.keys(repoMTimes).sort().join(",");
      const oldKeys = Object.keys(cached.repoMTimes || {}).sort().join(",");
      const sameKeys = curKeys === oldKeys;
      const sameMtimes =
        sameKeys &&
        Object.keys(repoMTimes).every((id) => (cached.repoMTimes as Record<string, number>)[id] === repoMTimes[id]);
      if (sameMtimes) {
        setMemory(cached.entries);
        return cached.entries;
      }
    }
  }

  const docEntries = indexWorkspace(root);
  const codeEntries = indexCode(root);
  const all = [...docEntries, ...codeEntries];
  try {
    await computeEmbeddingsForEntries(all);
  } catch {
    /* embeddings opcionales */
  }
  setMemory(all);
  saveToDisk(all, repoMTimes);
  return all;
}
