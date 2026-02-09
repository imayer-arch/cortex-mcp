import path from "node:path";
import type { MemoryEntry } from "./memory/types.js";
import { getWorkspaceRoot } from "./config/workspace.js";

function fileLink(entry: MemoryEntry): string {
  const root = getWorkspaceRoot();
  const full = path.join(root, entry.sourcePath).replace(/\\/g, "/");
  const url = "file:///" + full;
  return `[\`${entry.sourcePath}\`](${url})`;
}

export function formatEntry(entry: MemoryEntry, includeContent = false): string {
  let out = `### ${entry.title}\n`;
  out += `- **Origen:** ${entry.source} — ${fileLink(entry)}\n`;
  out += `- **Tipo:** ${entry.kind}\n`;
  if (entry.meta && (entry.kind === "contract" || entry.kind === "dependency" || entry.kind === "env_config" || entry.kind === "endpoint_mapping")) {
    if (entry.kind === "contract" && entry.meta.method)
      out += `- **Método/Path:** ${entry.meta.method} ${entry.meta.fullPath ?? ""}\n`;
    if (entry.kind === "contract" && (entry.meta.requestBodyType || entry.meta.responseType))
      out += `- **Body/Response:** ${entry.meta.requestBodyType ?? "—"} / ${entry.meta.responseType ?? "—"}\n`;
    if (entry.kind === "dependency" && entry.meta.toService)
      out += `- **Llama a:** ${entry.meta.toService}\n`;
    if (entry.kind === "env_config" && Array.isArray(entry.meta.vars))
      out += `- **Variables:** ${(entry.meta.vars as string[]).slice(0, 15).join(", ")}${(entry.meta.vars as string[]).length > 15 ? "…" : ""}\n`;
    if (entry.kind === "endpoint_mapping" && entry.meta.toService)
      out += `- **Servicio:** ${entry.meta.toService} (env: ${entry.meta.envVar ?? ""})\n`;
    if (entry.kind === "endpoint_mapping" && Array.isArray(entry.meta.calls)) {
      const calls = entry.meta.calls as { method: string; path: { literal?: string; pathKey?: string } }[];
      const lines = calls.slice(0, 25).map((c) => c.method + " " + (c.path.literal ?? `[${c.path.pathKey}]`));
      out += `- **Endpoints:** ${lines.join(", ")}${calls.length > 25 ? "…" : ""}\n`;
    }
  }
  if (entry.tags.length) out += `- **Etiquetas:** ${entry.tags.join(", ")}\n`;
  if (entry.references.length) out += `- **Referencias:** ${entry.references.join(", ")}\n`;
  if (includeContent && (entry.fullContent || entry.content)) {
    out += `\n**Contenido:**\n\n`;
    out += (entry.fullContent ?? entry.content).slice(0, 3000);
    if ((entry.fullContent ?? entry.content).length > 3000) out += "\n\n…";
    out += "\n";
  } else if (!includeContent && entry.content) {
    out += `\n${entry.content.slice(0, 500)}${entry.content.length > 500 ? "…" : ""}\n`;
  }
  return out;
}

export function formatAskWhy(entries: MemoryEntry[], query: string): string {
  if (entries.length === 0) {
    return `CORTEX no encontró evidencia en la memoria para **"${query}"**. Podés agregar ADRs, READMEs o docs en \`docs/\` de cada repo y ejecutar \`cortex_refresh\` para indexar.`;
  }
  let out = `## CORTEX — Memoria relacionada con "${query}"\n\n`;
  out += `Encontré **${entries.length}** pieza(s) de evidencia:\n\n`;
  for (const e of entries) {
    out += formatEntry(e, true) + "\n---\n\n";
  }
  return out;
}

const KIND_ORDER: MemoryEntry["kind"][] = [
  "repo_summary",
  "endpoint_mapping",
  "contract",
  "dependency",
  "env_config",
  "glossary",
  "convention",
  "db_table",
  "changelog",
  "adr",
  "readme",
  "doc",
  "post_mortem",
  "code_landmark",
];

export function formatGetContext(entries: MemoryEntry[], identifier: string): string {
  if (entries.length === 0) {
    return `CORTEX no tiene contexto indexado para **"${identifier}"**. Probá con el nombre del repo, un path de archivo, o un tema (ej. "pagos", "origination").`;
  }
  const byKind = new Map<MemoryEntry["kind"], MemoryEntry[]>();
  for (const e of entries) {
    const list = byKind.get(e.kind) ?? [];
    list.push(e);
    byKind.set(e.kind, list);
  }
  let out = `## CORTEX — Contexto para "${identifier}"\n\n`;
  for (const kind of KIND_ORDER) {
    const list = byKind.get(kind);
    if (!list?.length) continue;
    const kindLabel =
      kind === "repo_summary"
        ? "Resumen del repo"
        : kind === "endpoint_mapping"
          ? "Mapeo endpoint → servicio"
          : kind === "contract"
            ? "Contratos (endpoints)"
            : kind === "dependency"
              ? "Dependencias"
              : kind === "env_config"
                ? "Variables de entorno"
                : kind === "glossary"
                  ? "Glosario"
                  : kind === "db_table"
                    ? "Tablas DB"
                    : kind === "changelog"
                      ? "Changelog"
                      : kind;
    out += `### ${kindLabel}\n\n`;
    for (const e of list.slice(0, 15)) {
      out += formatEntry(e, true) + "\n";
    }
    if (list.length > 15) out += `\n… y ${list.length - 15} más.\n`;
    out += "\n";
  }
  return out;
}

export function formatFindDecisions(entries: MemoryEntry[], topic?: string): string {
  if (entries.length === 0) {
    return topic
      ? `No hay decisiones (ADRs/post-mortems) indexadas sobre **"${topic}"**.`
      : `No hay ADRs ni post-mortems indexados. Creá archivos en \`docs/adr/\` o \`docs/*.md\` y ejecutá \`cortex_refresh\`.`;
  }
  let out = `## CORTEX — Decisiones${topic ? ` sobre "${topic}"` : ""}\n\n`;
  out += `**${entries.length}** decisión(es) encontrada(s):\n\n`;
  for (const e of entries) {
    out += formatEntry(e, true) + "\n---\n\n";
  }
  return out;
}

export function formatRefresh(count: number): string {
  return `CORTEX actualizó la memoria. **${count}** pieza(s) indexada(s): docs (READMEs, ADRs), código (contratos, dependencias, mapeo endpoint→servicio, env, glosario, convenciones, tablas DB, changelog).`;
}

export function formatEndpointMapping(entries: MemoryEntry[]): string {
  if (entries.length === 0) {
    return "CORTEX no tiene mapeo endpoint→servicio indexado. Los repos que llaman a otros (p. ej. BFF que usa createAxiosInstance con configService.get) se indexan al hacer **cortex_refresh**.";
  }
  let out = `## CORTEX — Mapeo endpoint → servicio\n\n`;
  out += `Cada bloque indica **qué repo** llama a **qué servicio** y con **qué endpoints** (método + path).\n\n`;
  for (const e of entries) {
    out += `### ${e.title}\n`;
    out += `- **Origen:** ${e.source} — ${fileLink(e)}\n`;
    if (e.meta?.envVar) out += `- **Variable env:** ${e.meta.envVar}\n`;
    if (Array.isArray(e.meta?.calls)) {
      const calls = e.meta.calls as { method: string; path: { literal?: string; pathKey?: string } }[];
      out += `- **Endpoints llamados:**\n`;
      for (const c of calls.slice(0, 50)) {
        const pathStr = c.path.literal ?? `[${c.path.pathKey}]`;
        out += `  - ${c.method} ${pathStr}\n`;
      }
      if (calls.length > 50) out += `  - … y ${calls.length - 50} más\n`;
    }
    out += "\n";
  }
  return out;
}

export function formatHowTo(
  topic: string,
  summaries: MemoryEntry[],
  contracts: MemoryEntry[],
  decisions: MemoryEntry[],
  glossary: MemoryEntry[]
): string {
  let out = `## CORTEX — Cómo se hace "${topic}" en el workspace\n\n`;
  if (summaries.length > 0) {
    out += "### Repos involucrados\n\n";
    for (const e of summaries.slice(0, 5)) {
      out += `- **${e.source}:** ${e.content.slice(0, 300)}${e.content.length > 300 ? "…" : ""}\n`;
    }
    out += "\n";
  }
  if (contracts.length > 0) {
    out += "### Endpoints (código)\n\n";
    for (const e of contracts.slice(0, 10)) {
      out += `- ${e.title} — ${e.source} — ${e.sourcePath}\n`;
    }
    out += "\n";
  }
  if (decisions.length > 0) {
    out += "### Decisiones (ADRs)\n\n";
    for (const e of decisions.slice(0, 5)) {
      out += `- ${e.title} — ${e.source}\n`;
    }
    out += "\n";
  }
  if (glossary.length > 0) {
    out += "### Términos de dominio\n\n";
    for (const e of glossary.slice(0, 8)) {
      out += `- ${e.title} (${e.source})\n`;
    }
  }
  if (!summaries.length && !contracts.length && !decisions.length && !glossary.length) {
    out += `No encontré evidencia específica para **"${topic}"**. Probá con \`cortex_ask_why\` o \`cortex_get_context\` usando el nombre del repo o un término más amplio.`;
  }
  return out;
}

export function formatImpactAnalysis(
  identifier: string,
  contracts: MemoryEntry[],
  callers: { fromRepo: string; toService: string; method: string; path: string }[],
  decisions: MemoryEntry[]
): string {
  let out = `## CORTEX — ¿Este cambio rompe algo? ("${identifier}")\n\n`;
  if (contracts.length > 0) {
    out += "### Contratos afectados (este repo expone)\n\n";
    for (const c of contracts.slice(0, 15)) {
      out += `- ${c.title} — ${fileLink(c)}\n`;
    }
    out += "\n";
  }
  if (callers.length > 0) {
    const byCaller = new Map<string, { toService: string; calls: string[] }>();
    for (const x of callers) {
      const key = x.fromRepo;
      const existing = byCaller.get(key);
      if (!existing) byCaller.set(key, { toService: x.toService, calls: [`${x.method} ${x.path}`] });
      else existing.calls.push(`${x.method} ${x.path}`);
    }
    out += "### Quién llama a este servicio/endpoint (cuidado al cambiar)\n\n";
    for (const [fromRepo, { toService, calls }] of byCaller) {
      out += `- **${fromRepo}** → ${toService}: ${calls.slice(0, 5).join(", ")}${calls.length > 5 ? "…" : ""}\n`;
    }
    out += "\n";
  }
  if (decisions.length > 0) {
    out += "### Decisiones (ADRs/post-mortems) relacionadas\n\n";
    for (const d of decisions.slice(0, 5)) {
      out += `- ${d.title} — ${d.source}\n`;
    }
  }
  if (contracts.length === 0 && callers.length === 0 && decisions.length === 0) {
    out += `No hay contratos, llamadores ni decisiones indexados para **"${identifier}"**. Podés usar \`cortex_who_calls_endpoint\` con un path o \`cortex_get_context\` con el repo.`;
  }
  return out;
}

export function formatWhoCallsEndpoint(
  pathFragment: string,
  callers: { fromRepo: string; toService: string; method: string; path: string; filePaths: string[] }[]
): string {
  if (callers.length === 0) {
    return `CORTEX no encontró llamadas a **"${pathFragment}"** en el mapeo indexado. Probá con otro fragmento de path o ejecutá \`cortex_refresh\`.`;
  }
  let out = `## CORTEX — Quién llama a "${pathFragment}"\n\n`;
  const seen = new Set<string>();
  for (const x of callers) {
    const key = `${x.fromRepo}:${x.toService}:${x.method}:${x.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out += `- **${x.fromRepo}** → ${x.toService}: ${x.method} ${x.path}\n`;
  }
  return out;
}

export function formatDependencyGraph(
  edges: { from: string; to: string }[],
  format: "mermaid" | "dot"
): string {
  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
  }
  if (format === "mermaid") {
    let out = "```mermaid\ngraph LR\n";
    for (const e of edges) {
      const from = e.from.replace(/-/g, "_");
      const to = e.to.replace(/-/g, "_");
      out += `  ${from}-->${to}\n`;
    }
    out += "```";
    return out;
  }
  let out = "digraph deps {\n";
  for (const n of nodes) {
    out += `  "${n}" [label="${n}"];\n`;
  }
  for (const e of edges) {
    out += `  "${e.from}" -> "${e.to}";\n`;
  }
  out += "}\n";
  return out;
}

export function formatContextWarnings(callerCount: number, postMortems: MemoryEntry[]): string {
  if (callerCount < 2 && postMortems.length === 0) return "";
  let out = "\n---\n\n### ⚠️ Advertencias\n\n";
  if (callerCount >= 2) {
    out += `- Este repo es llamado por **${callerCount}** servicio(s). Cuidado al cambiar contratos o paths.\n`;
  }
  if (postMortems.length > 0) {
    out += `- Aparece en **${postMortems.length}** post-mortem(s) o ADR(s): ${postMortems.slice(0, 3).map((e) => e.title).join(", ")}.\n`;
  }
  return out;
}
