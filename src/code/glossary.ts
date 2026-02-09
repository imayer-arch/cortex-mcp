import type { RouteInfo } from "./routes.js";

/** Extract domain-like terms from path segments (e.g. applications, guarantees -> application, guarantee). */
function pathSegmentsToTerms(fullPath: string): string[] {
  const segments = fullPath.split("/").filter((s) => s && !/^\d+$/.test(s) && !/^:/.test(s));
  const terms: string[] = [];
  for (const s of segments) {
    const normalized = s.replace(/-/g, " ").replace(/_/g, " ");
    if (normalized.length > 2) terms.push(normalized);
    const singular = s.replace(/s$/, "").replace(/-/g, " ");
    if (singular.length > 2) terms.push(singular);
  }
  return [...new Set(terms)];
}

export interface GlossaryTerm {
  term: string;
  source: string;
  sourcePath: string;
  kind: "route" | "dto" | "entity";
  line?: number;
}

export function glossaryFromRoutes(repoId: string, routes: RouteInfo[], filePathBase: string): GlossaryTerm[] {
  const terms: GlossaryTerm[] = [];
  const seen = new Set<string>();

  for (const r of routes) {
    const pathTerms = pathSegmentsToTerms(r.fullPath);
    for (const t of pathTerms) {
      const key = `${repoId}:${t}`;
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push({
        term: t,
        source: repoId,
        sourcePath: r.filePath,
        kind: "route",
        line: r.line,
      });
    }
    if (r.requestBodyType && r.requestBodyType.length > 2) {
      const key = `${repoId}:${r.requestBodyType}`;
      if (!seen.has(key)) {
        seen.add(key);
        terms.push({
          term: r.requestBodyType,
          source: repoId,
          sourcePath: r.filePath,
          kind: "dto",
          line: r.line,
        });
      }
    }
    if (r.responseType && r.responseType.length > 2) {
      const key = `${repoId}:${r.responseType}`;
      if (!seen.has(key)) {
        seen.add(key);
        terms.push({
          term: r.responseType,
          source: repoId,
          sourcePath: r.filePath,
          kind: "dto",
          line: r.line,
        });
      }
    }
  }
  return terms;
}
