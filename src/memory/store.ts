import type { MemoryEntry } from "./types.js";

let memory: MemoryEntry[] = [];

export function getMemory(): MemoryEntry[] {
  return memory;
}

export function setMemory(entries: MemoryEntry[]): void {
  memory = entries;
}

export function addToMemory(entry: MemoryEntry): void {
  memory.push(entry);
}

export function clearMemory(): void {
  memory = [];
}

/**
 * Búsqueda simple por coincidencia en title, content, tags, source.
 */
export function searchMemory(query: string, limit = 20): MemoryEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return memory.slice(0, limit);

  const scored = memory.map((entry) => {
    let score = 0;
    const titleLower = entry.title.toLowerCase();
    const contentLower = entry.content.toLowerCase();
    const sourceLower = entry.source.toLowerCase();
    const tagsLower = entry.tags.join(" ").toLowerCase();
    const refsLower = entry.references.join(" ").toLowerCase();

    if (titleLower.includes(q)) score += 10;
    if (contentLower.includes(q)) score += 5;
    if (sourceLower.includes(q)) score += 3;
    if (tagsLower.includes(q)) score += 4;
    if (refsLower.includes(q)) score += 2;

    const words = q.split(/\s+/).filter((w) => w.length > 2);
    for (const word of words) {
      if (titleLower.includes(word)) score += 3;
      if (contentLower.includes(word)) score += 1;
      if (tagsLower.includes(word)) score += 2;
    }
    return { entry, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.entry);
}

/**
 * Buscar por path o identificador (ej. nombre de archivo, endpoint).
 */
export function findByIdentifier(identifier: string): MemoryEntry[] {
  const id = identifier.toLowerCase().replace(/\\/g, "/");
  return memory.filter(
    (e) =>
      e.sourcePath.toLowerCase().includes(id) ||
      e.source.toLowerCase().includes(id) ||
      e.title.toLowerCase().includes(id) ||
      e.references.some((r) => r.toLowerCase().includes(id))
  );
}

/**
 * Solo decisiones (ADRs, post-mortems).
 */
export function findDecisions(topic?: string): MemoryEntry[] {
  let entries = memory.filter((e) => e.kind === "adr" || e.kind === "post_mortem");
  if (topic) {
    const t = topic.toLowerCase();
    entries = entries.filter(
      (e) =>
        e.title.toLowerCase().includes(t) ||
        e.content.toLowerCase().includes(t) ||
        e.tags.some((tag) => tag.toLowerCase().includes(t))
    );
  }
  return entries;
}

export function findRepoSummary(repoId: string): MemoryEntry | undefined {
  return memory.find((e) => e.kind === "repo_summary" && e.source === repoId);
}

export function findContracts(serviceId?: string, pathFragment?: string): MemoryEntry[] {
  let entries = memory.filter((e) => e.kind === "contract");
  if (serviceId)
    entries = entries.filter((e) => e.source.toLowerCase() === serviceId.toLowerCase());
  if (pathFragment) {
    const frag = pathFragment.toLowerCase();
    entries = entries.filter(
      (e) =>
        (e.meta?.fullPath as string)?.toLowerCase().includes(frag) ||
        e.title.toLowerCase().includes(frag)
    );
  }
  return entries;
}

export function findDependencies(fromRepo?: string, toService?: string): MemoryEntry[] {
  let entries = memory.filter((e) => e.kind === "dependency");
  if (fromRepo) entries = entries.filter((e) => e.source === fromRepo);
  if (toService)
    entries = entries.filter((e) => (e.meta?.toService as string) === toService);
  return entries;
}

export function findEnvConfig(repoId: string): MemoryEntry | undefined {
  return memory.find((e) => e.kind === "env_config" && e.source === repoId);
}

export function findChangelog(repoId?: string): MemoryEntry[] {
  let entries = memory.filter((e) => e.kind === "changelog");
  if (repoId) entries = entries.filter((e) => e.source === repoId);
  return entries;
}

export function findGlossary(term?: string, repoId?: string): MemoryEntry[] {
  let entries = memory.filter((e) => e.kind === "glossary");
  if (term) {
    const t = term.toLowerCase();
    entries = entries.filter(
      (e) => e.title.toLowerCase().includes(t) || e.content.toLowerCase().includes(t)
    );
  }
  if (repoId) entries = entries.filter((e) => e.source === repoId);
  return entries;
}

export function findDbTables(repoId?: string, tableName?: string): MemoryEntry[] {
  let entries = memory.filter((e) => e.kind === "db_table");
  if (repoId) entries = entries.filter((e) => e.source === repoId);
  if (tableName) {
    const t = tableName.toLowerCase();
    entries = entries.filter(
      (e) => e.title.toLowerCase().includes(t) || (e.meta?.tableName as string)?.toLowerCase() === t
    );
  }
  return entries;
}

export function findEndpointMapping(fromRepo?: string, toService?: string): MemoryEntry[] {
  let entries = memory.filter((e) => e.kind === "endpoint_mapping");
  if (fromRepo) entries = entries.filter((e) => e.source === fromRepo || e.meta?.fromRepo === fromRepo);
  if (toService)
    entries = entries.filter((e) => (e.meta?.toService as string)?.toLowerCase() === toService.toLowerCase());
  return entries;
}

/** Quién llama a un path o servicio: desde endpoint_mapping, filtra calls que coincidan con pathFragment. */
export function getCallersOfPath(pathFragment: string): { fromRepo: string; toService: string; method: string; path: string; filePaths: string[] }[] {
  const frag = pathFragment.toLowerCase().trim();
  if (!frag) return [];
  const results: { fromRepo: string; toService: string; method: string; path: string; filePaths: string[] }[] = [];
  const entries = memory.filter((e) => e.kind === "endpoint_mapping");
  for (const e of entries) {
    const fromRepo = (e.meta?.fromRepo as string) ?? e.source;
    const toService = (e.meta?.toService as string) ?? "";
    const filePaths = (e.meta?.filePaths as string[]) ?? [e.sourcePath];
    const calls = (e.meta?.calls as { method: string; path: { literal?: string; pathKey?: string } }[]) ?? [];
    for (const c of calls) {
      const pathStr = c.path.literal ?? `[${c.path.pathKey}]`;
      if (pathStr.toLowerCase().includes(frag) || (c.path.pathKey && c.path.pathKey.toLowerCase().includes(frag))) {
        results.push({ fromRepo, toService, method: c.method, path: pathStr, filePaths });
      }
    }
  }
  return results;
}

/** Cuántos repos distintos llaman a un servicio (toService). */
export function countCallersOfService(toService: string): number {
  const entries = findEndpointMapping(undefined, toService);
  return new Set(entries.map((e) => (e.meta?.fromRepo as string) ?? e.source)).size;
}
