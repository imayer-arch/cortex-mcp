#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { refreshMemory } from "./indexer.js";
import {
  searchMemory,
  searchMemoryByEmbedding,
  findByIdentifier,
  findDecisions,
  findContracts,
  findRepoSummary,
  findGlossary,
  findEndpointMapping,
  getCallersOfPath,
  countCallersOfService,
  getMemory,
} from "./memory/store.js";
import { getEmbedder } from "./embeddings.js";
import {
  formatAskWhy,
  formatGetContext,
  formatFindDecisions,
  formatRefresh,
  formatHowTo,
  formatEndpointMapping,
  formatImpactAnalysis,
  formatWhoCallsEndpoint,
  formatDependencyGraph,
  formatContextWarnings,
} from "./formatters.js";

async function main() {
  const server = new Server(
    { name: "cortex-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "cortex_refresh",
        description: "Refresca la memoria de CORTEX: reindexa READMEs, docs y código. Usa caché en disco si los repos no cambiaron (incremental). Opcional: forceFull=true para reindexar siempre.",
        inputSchema: {
          type: "object" as const,
          properties: {
            forceFull: { type: "boolean", description: "Si true, reindexa todo ignorando caché." },
          },
        },
      },
      {
        name: "cortex_ask_why",
        description: 'Preguntá "por qué existe esto" o buscá contexto. CORTEX busca en ADRs, READMEs y docs indexados y devuelve evidencia con enlaces al archivo.',
        inputSchema: {
          type: "object" as const,
          properties: {
            query: { type: "string", description: "Pregunta o tema (ej. por qué pagos son idempotentes, origination, alta de cliente)" },
            limit: { type: "number", description: "Máximo de resultados (default 10)" },
          },
          required: ["query"],
        },
      },
      {
        name: "cortex_get_context",
        description: "Obtené todo el contexto que CORTEX tiene sobre un repo, archivo, endpoint o tema. Ideal antes de tocar código.",
        inputSchema: {
          type: "object" as const,
          properties: {
            identifier: { type: "string", description: "Repo (bff-moor), path (ms-application/docs/HELP.md), o tema" },
          },
          required: ["identifier"],
        },
      },
      {
        name: "cortex_find_decisions",
        description: "Lista decisiones (ADRs, post-mortems) indexadas. Opcionalmente filtrá por tema.",
        inputSchema: {
          type: "object" as const,
          properties: {
            topic: { type: "string", description: "Filtrar por tema (ej. pagos, seguridad, idempotencia)" },
          },
        },
      },
      {
        name: "cortex_how_to",
        description: 'Respuesta tipo "cómo se hace X en el workspace": repos, endpoints (código), ADRs y términos de dominio. Ej: origination, pagos, garantías.',
        inputSchema: {
          type: "object" as const,
          properties: {
            topic: { type: "string", description: "Tema o flujo (ej. origination, pagos, garantías, alta de cliente)" },
          },
          required: ["topic"],
        },
      },
      {
        name: "cortex_get_endpoint_mapping",
        description: "Mapeo dinámico: qué repo llama a qué servicio y con qué endpoints (método + path). Extraído del código (createAxiosInstance + paths). Opcional: filtrar por fromRepo o toService.",
        inputSchema: {
          type: "object" as const,
          properties: {
            fromRepo: { type: "string", description: "Filtrar por repo que hace las llamadas (ej. bff-moor)" },
            toService: { type: "string", description: "Filtrar por servicio destino (ej. ms-application)" },
          },
        },
      },
      {
        name: "cortex_impact_analysis",
        description: "¿Este cambio rompe algo? Indicá un repo, path o endpoint. CORTEX cruza contratos, quién llama a ese servicio y ADRs/post-mortems.",
        inputSchema: {
          type: "object" as const,
          properties: {
            identifier: { type: "string", description: "Repo (ms-application), path (applications) o endpoint" },
          },
          required: ["identifier"],
        },
      },
      {
        name: "cortex_export_dependency_graph",
        description: "Grafo de dependencias entre repos (quién llama a quién). Formato: mermaid o dot. Dinámico según el workspace.",
        inputSchema: {
          type: "object" as const,
          properties: {
            format: { type: "string", description: "mermaid o dot", enum: ["mermaid", "dot"] },
          },
        },
      },
      {
        name: "cortex_who_calls_endpoint",
        description: "Quién llama a un path o endpoint. Indicá un fragmento de path (ej. applications, v1/private).",
        inputSchema: {
          type: "object" as const,
          properties: {
            pathFragment: { type: "string", description: "Fragmento de path o nombre de endpoint" },
          },
          required: ["pathFragment"],
        },
      },
      {
        name: "cortex_export_endpoints",
        description: "Exporta contratos y mapeo endpoint→servicio en JSON (documentación, scripts o comparación manual). CORTEX no depende de ningún otro MCP.",
        inputSchema: {
          type: "object" as const,
          properties: {
            format: { type: "string", description: "json (default)", enum: ["json"] },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const a = (args || {}) as Record<string, unknown>;

    try {
      if (name === "cortex_refresh") {
        const forceFull = a.forceFull === true;
        const entries = await refreshMemory(forceFull);
        return {
          content: [{ type: "text" as const, text: formatRefresh(entries.length) }],
        };
      }

      if (name === "cortex_ask_why") {
        const query = String(a.query ?? "").trim();
        const limit = typeof a.limit === "number" ? Math.min(a.limit, 20) : 10;
        if (!query) {
          return { content: [{ type: "text" as const, text: "Escribí una pregunta o tema en el parámetro `query`." }], isError: true };
        }
        let entries: ReturnType<typeof searchMemory>;
        try {
          const embed = await getEmbedder();
          if (embed) {
            const qEmb = await embed(query);
            if (qEmb.length) entries = searchMemoryByEmbedding(qEmb, limit);
            else entries = searchMemory(query, limit);
          } else {
            entries = searchMemory(query, limit);
          }
        } catch {
          entries = searchMemory(query, limit);
        }
        const text = formatAskWhy(entries, query);
        return { content: [{ type: "text" as const, text }] };
      }

      if (name === "cortex_get_context") {
        const identifier = String(a.identifier ?? "").trim();
        if (!identifier) {
          return { content: [{ type: "text" as const, text: "Indicá un repo, path o tema en `identifier`." }], isError: true };
        }
        const byId = findByIdentifier(identifier);
        const bySearch = searchMemory(identifier, 15);
        const byContracts = findContracts(undefined, identifier);
        const combined = [...byId];
        const seen = new Set(byId.map((e) => e.id));
        for (const e of [...bySearch, ...byContracts]) {
          if (!seen.has(e.id)) {
            seen.add(e.id);
            combined.push(e);
          }
        }
        const repoSummary = findRepoSummary(identifier);
        if (repoSummary && !seen.has(repoSummary.id)) {
          combined.unshift(repoSummary);
        }
        let text = formatGetContext(combined.slice(0, 25), identifier);
        const repoId = repoSummary?.source ?? combined.find((e) => e.source)?.source;
        if (repoId) {
          const callerCount = countCallersOfService(repoId);
          const decisions = findDecisions(identifier);
          const postMortems = decisions.filter((e) => e.kind === "post_mortem" || e.content.toLowerCase().includes("breaking"));
          const warnings = formatContextWarnings(callerCount, postMortems);
          if (warnings) text += warnings;
        }
        return { content: [{ type: "text" as const, text }] };
      }

      if (name === "cortex_find_decisions") {
        const topic = typeof a.topic === "string" ? a.topic.trim() : undefined;
        const entries = findDecisions(topic);
        const text = formatFindDecisions(entries, topic);
        return { content: [{ type: "text" as const, text }] };
      }

      if (name === "cortex_how_to") {
        const topic = String(a.topic ?? "").trim();
        if (!topic) {
          return { content: [{ type: "text" as const, text: "Indicá un tema en `topic` (ej. origination, pagos)." }], isError: true };
        }
        const searchEntries = searchMemory(topic, 20);
        const contracts = findContracts(undefined, topic);
        const decisions = findDecisions(topic);
        const glossary = findGlossary(topic);
        const frontRoutes = searchEntries.filter((e) => e.kind === "front_route");
        const frontEndpointUsages = searchEntries.filter((e) => e.kind === "front_endpoint_usage");
        const repoIds = new Set<string>();
        for (const e of [...searchEntries, ...contracts, ...glossary]) {
          repoIds.add(e.source);
        }
        const summaries = [];
        for (const id of repoIds) {
          const s = findRepoSummary(id);
          if (s) summaries.push(s);
        }
        if (summaries.length === 0)
          for (const e of searchEntries)
            if (e.kind === "repo_summary") summaries.push(e);
        const text = formatHowTo(topic, summaries, contracts, decisions, glossary, frontRoutes, frontEndpointUsages);
        return { content: [{ type: "text" as const, text }] };
      }

      if (name === "cortex_get_endpoint_mapping") {
        const fromRepo = typeof a.fromRepo === "string" ? a.fromRepo.trim() || undefined : undefined;
        const toService = typeof a.toService === "string" ? a.toService.trim() || undefined : undefined;
        const entries = findEndpointMapping(fromRepo, toService);
        const text = formatEndpointMapping(entries);
        return { content: [{ type: "text" as const, text }] };
      }

      if (name === "cortex_impact_analysis") {
        const identifier = String(a.identifier ?? "").trim();
        if (!identifier) {
          return { content: [{ type: "text" as const, text: "Indicá un repo, path o endpoint en `identifier`." }], isError: true };
        }
        const contracts = findContracts(identifier, identifier);
        const mappingEntries = findEndpointMapping(undefined, identifier);
        const callers: { fromRepo: string; toService: string; method: string; path: string }[] = [];
        for (const e of mappingEntries) {
          const fromRepo = (e.meta?.fromRepo as string) ?? e.source;
          const toService = (e.meta?.toService as string) ?? "";
          const calls = (e.meta?.calls as { method: string; path: { literal?: string; pathKey?: string } }[]) ?? [];
          for (const c of calls) {
            callers.push({
              fromRepo,
              toService,
              method: c.method,
              path: c.path.literal ?? `[${c.path.pathKey}]`,
            });
          }
        }
        const pathCallers = getCallersOfPath(identifier);
        for (const x of pathCallers) {
          callers.push({ fromRepo: x.fromRepo, toService: x.toService, method: x.method, path: x.path });
        }
        const decisions = findDecisions(identifier);
        const text = formatImpactAnalysis(identifier, contracts, callers, decisions);
        return { content: [{ type: "text" as const, text }] };
      }

      if (name === "cortex_export_dependency_graph") {
        const format = (a.format === "dot" ? "dot" : "mermaid") as "mermaid" | "dot";
        const entries = getMemory();
        const edges: { from: string; to: string }[] = [];
        const seen = new Set<string>();
        for (const e of entries) {
          if (e.kind === "endpoint_mapping" && e.meta?.fromRepo && e.meta?.toService) {
            const from = String(e.meta.fromRepo);
            const to = String(e.meta.toService);
            if (!seen.has(from + "->" + to)) {
              seen.add(from + "->" + to);
              edges.push({ from, to });
            }
          }
          if (e.kind === "dependency" && e.meta?.toService) {
            const from = e.source;
            const to = String(e.meta.toService);
            if (!seen.has(from + "->" + to)) {
              seen.add(from + "->" + to);
              edges.push({ from, to });
            }
          }
        }
        const text = formatDependencyGraph(edges, format);
        return { content: [{ type: "text" as const, text }] };
      }

      if (name === "cortex_who_calls_endpoint") {
        const pathFragment = String(a.pathFragment ?? "").trim();
        if (!pathFragment) {
          return { content: [{ type: "text" as const, text: "Indicá un fragmento de path en `pathFragment`." }], isError: true };
        }
        const callers = getCallersOfPath(pathFragment);
        const text = formatWhoCallsEndpoint(pathFragment, callers);
        return { content: [{ type: "text" as const, text }] };
      }

      if (name === "cortex_export_endpoints") {
        const entries = getMemory();
        const contracts = entries.filter((e) => e.kind === "contract").map((e) => ({
          repo: e.source,
          method: e.meta?.method,
          path: e.meta?.fullPath,
          sourcePath: e.sourcePath,
        }));
        const endpointMappings = entries.filter((e) => e.kind === "endpoint_mapping").map((e) => ({
          fromRepo: e.meta?.fromRepo ?? e.source,
          toService: e.meta?.toService,
          envVar: e.meta?.envVar,
          filePaths: e.meta?.filePaths,
          calls: (e.meta?.calls as { method: string; path: unknown }[])?.slice(0, 50),
        }));
        const text = JSON.stringify({ contracts, endpointMappings }, null, 2);
        return { content: [{ type: "text" as const, text }] };
      }

      return { content: [{ type: "text" as const, text: `Herramienta desconocida: ${name}` }], isError: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `CORTEX error: ${message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Cargar caché en disco si existe; si no, memoria queda vacía hasta cortex_refresh
  try {
    const { loadFromDisk } = await import("./memory/persistence.js");
    const { setMemory } = await import("./memory/store.js");
    const cached = loadFromDisk();
    if (cached?.entries?.length) {
      setMemory(cached.entries);
    }
  } catch {
    // Si falla, la memoria queda vacía hasta cortex_refresh
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
