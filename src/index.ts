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
  findAllResponseSchemas,
} from "./memory/store.js";
import { getEmbedder } from "./embeddings.js";
import {
  formatAskWhy,
  formatGetContext,
  formatFindDecisions,
  formatRefresh,
  formatHowTo,
  formatGetFlow,
  formatEndpointMapping,
  formatImpactAnalysis,
  formatWhoCallsEndpoint,
  formatDependencyGraph,
  formatContextWarnings,
} from "./formatters.js";
import type { FlowScreen } from "./formatters.js";
import type { MemoryEntry } from "./memory/types.js";
import { buildOpenApiFromContracts, buildMockInstructions, getMockPort, type ResponseSchemaShape } from "./openapi.js";
import { getWorkspaceRoot } from "./config/workspace.js";
import fs from "node:fs";
import path from "node:path";

/**
 * Construye entradas sintéticas "Ruta → Endpoints" desde front_route + front_endpoint_usage + service_endpoint.
 * Agnóstico: si el indexador no generó route_endpoints (p. ej. por formato de paths), derivamos la misma vista.
 */
function buildSyntheticRouteEndpoints(
  frontRoutes: MemoryEntry[],
  frontEndpointUsages: MemoryEntry[],
  serviceEndpoints: MemoryEntry[]
): MemoryEntry[] {
  const methodToEndpoint = new Map<string, { httpMethod: string; pathPattern: string }>();
  for (const se of serviceEndpoints) {
    const methodName = (se.meta?.methodName as string) ?? "";
    const serviceName = (se.meta?.serviceName as string) ?? "";
    if (!methodName) continue;
    const key = `${serviceName}:${methodName}`;
    if (!methodToEndpoint.has(key))
      methodToEndpoint.set(key, {
        httpMethod: (se.meta?.httpMethod as string) ?? "",
        pathPattern: (se.meta?.pathPattern as string) ?? "",
      });
    if (!methodToEndpoint.has(methodName))
      methodToEndpoint.set(methodName, {
        httpMethod: (se.meta?.httpMethod as string) ?? "",
        pathPattern: (se.meta?.pathPattern as string) ?? "",
      });
  }
  const usagesBySource = new Map<string, MemoryEntry[]>();
  for (const u of frontEndpointUsages) {
    const p = u.sourcePath.replace(/\\/g, "/").toLowerCase();
    if (!usagesBySource.has(p)) usagesBySource.set(p, []);
    usagesBySource.get(p)!.push(u);
  }
  const out: MemoryEntry[] = [];
  for (const fr of frontRoutes) {
    const path = (fr.meta?.path as string) ?? "";
    const componentName = (fr.meta?.componentName as string) ?? "";
    const keyPath = fr.sourcePath.replace(/\\/g, "/").toLowerCase();
    const usages = usagesBySource.get(keyPath) ?? [];
    const endpointSet = new Map<string, { methodName: string; httpMethod: string; pathPattern: string }>();
    for (const u of usages) {
      const methods = (u.meta?.invokedMethods as string[]) ?? [];
      const svc = (u.meta?.serviceName as string) ?? "";
      for (const m of methods) {
        const ep = methodToEndpoint.get(`${svc}:${m}`) ?? methodToEndpoint.get(m);
        if (ep && !endpointSet.has(m))
          endpointSet.set(m, { methodName: m, httpMethod: ep.httpMethod, pathPattern: ep.pathPattern });
      }
    }
    const endpoints = [...endpointSet.values()];
    const id = `synthetic:${fr.source}:${fr.sourcePath}:route`;
    out.push({
      id,
      kind: "route_endpoints",
      source: fr.source,
      sourcePath: fr.sourcePath,
      title: endpoints.length ? `Ruta ${path} — ${endpoints.length} endpoint(s)` : `Ruta ${path} (${componentName})`,
      content: endpoints.length
        ? `Ruta ${path} (${componentName}) usa: ${endpoints.map((e) => `${e.httpMethod} ${e.pathPattern}`).join(", ")}.`
        : `Ruta ${path}. Componente: ${componentName}.`,
      tags: ["front", "route-endpoints", "synthetic"],
      references: [],
      meta: { path, componentName, endpoints },
    });
  }
  return out;
}

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
      {
        name: "cortex_get_flow",
        description: 'Capa "flujo": en una llamada devuelve pantallas, endpoints por pantalla y acciones UI → endpoint. Ej: cortex_get_flow("committee") para comité.',
        inputSchema: {
          type: "object" as const,
          properties: {
            topic: { type: "string", description: "Tema o flujo (ej. committee, comite, origination)" },
          },
          required: ["topic"],
        },
      },
      {
        name: "cortex_export_openapi",
        description: "Exporta OpenAPI 3.0 desde contratos indexados para mockear servicios sin levantarlos. Opcional: serviceId (un servicio), topic (flujo). Incluye instrucciones para levantar el mock (Prism) y validar requests. Sin datos sensibles.",
        inputSchema: {
          type: "object" as const,
          properties: {
            serviceId: { type: "string", description: "Solo este servicio (ej. ms-application). Si no se pasa, se listan todos los que tengan contratos." },
            topic: { type: "string", description: "Solo endpoints del flujo (ej. committee). Genera un OpenAPI del flujo." },
            format: { type: "string", description: "Salida: json (default) o yaml", enum: ["json", "yaml"] },
            outputPath: { type: "string", description: "Si se indica, escribe el OpenAPI en este path (solo dentro del workspace). Ej: cortex-mocks/bff-moor.json" },
          },
        },
      },
      {
        name: "cortex_list_running_mocks",
        description: "Indica qué servicios mockeados están levantados: consulta los puertos que CORTEX asigna a cada servicio con contratos (4010, 4011, …) y devuelve cuáles responden. Útil para preguntas como «qué mocks tengo» o «qué servicios están mockeados».",
        inputSchema: {
          type: "object" as const,
          properties: {},
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
        const searchEntries = searchMemory(topic, 25);
        const contracts = findContracts(undefined, topic);
        const decisions = findDecisions(topic);
        const glossary = findGlossary(topic);
        const frontRoutes = searchEntries.filter((e) => e.kind === "front_route");
        const frontEndpointUsages = searchEntries.filter((e) => e.kind === "front_endpoint_usage");
        const serviceEndpoints = searchEntries.filter((e) => e.kind === "service_endpoint");
        let routeEndpoints = searchEntries.filter((e) => e.kind === "route_endpoints");
        const uiActions = searchEntries.filter((e) => e.kind === "ui_action");
        // Priorizar/asegurar route_endpoints cuando el tema es flujo/ruta/comité
        const flowTopic = /comite|committee|flujo|ruta|pantalla|instrumentacion|endpoint.*pantalla/i.test(topic);
        if (flowTopic) {
          const all = getMemory();
          const routeFromMemory = all.filter((e) => e.kind === "route_endpoints");
          const topicLower = topic.toLowerCase();
          const matches = routeFromMemory.filter((e) => {
            const path = ((e.meta?.path as string) ?? "").toLowerCase();
            const comp = ((e.meta?.componentName as string) ?? "").toLowerCase();
            const tags = e.tags.join(" ").toLowerCase();
            return path.includes(topicLower) || comp.includes(topicLower) || tags.includes(topicLower);
          });
          const seen = new Set(routeEndpoints.map((e) => e.id));
          for (const e of matches) {
            if (!seen.has(e.id)) {
              seen.add(e.id);
              routeEndpoints = [e, ...routeEndpoints];
            }
          }
        }
        // Agnóstico: si no hay route_endpoints indexados, derivar "Ruta → Endpoints" desde front_route + usos
        if (routeEndpoints.length === 0 && (frontEndpointUsages.length > 0 || serviceEndpoints.length > 0)) {
          let routesForSynthetic = frontRoutes;
          if (routesForSynthetic.length === 0 && (flowTopic || frontEndpointUsages.length > 0)) {
            const topicLower = topic.toLowerCase();
            routesForSynthetic = getMemory().filter((e) => {
              if (e.kind !== "front_route") return false;
              const path = ((e.meta?.path as string) ?? "").toLowerCase();
              const comp = ((e.meta?.componentName as string) ?? "").toLowerCase();
              const tags = e.tags.join(" ").toLowerCase();
              return path.includes(topicLower) || comp.includes(topicLower) || tags.includes(topicLower);
            });
          }
          if (routesForSynthetic.length > 0) {
            const usagesForSynthetic = frontEndpointUsages.length > 0 ? frontEndpointUsages : getMemory().filter((e) => e.kind === "front_endpoint_usage");
            const servicesForSynthetic = serviceEndpoints.length > 0 ? serviceEndpoints : getMemory().filter((e) => e.kind === "service_endpoint");
            routeEndpoints = buildSyntheticRouteEndpoints(routesForSynthetic, usagesForSynthetic, servicesForSynthetic);
          }
        }
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
        const text = formatHowTo(topic, summaries, contracts, decisions, glossary, frontRoutes, frontEndpointUsages, serviceEndpoints, routeEndpoints, uiActions);
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

      if (name === "cortex_get_flow") {
        const topic = String(a.topic ?? "").trim();
        if (!topic) {
          return { content: [{ type: "text" as const, text: "Indicá un tema en `topic` (ej. committee, origination)." }], isError: true };
        }
        const flowEntries = searchMemory(topic, 50);
        const routeEndpoints = flowEntries.filter((e) => e.kind === "route_endpoints");
        const uiActions = flowEntries.filter((e) => e.kind === "ui_action");
        const screensBySourcePath = new Map<string, FlowScreen>();
        for (const re of routeEndpoints) {
          const path = (re.meta?.path as string) ?? re.title;
          const componentName = (re.meta?.componentName as string) ?? "";
          const endpoints = (re.meta?.endpoints as { methodName: string; httpMethod: string; pathPattern: string }[]) ?? [];
          if (!screensBySourcePath.has(re.sourcePath)) {
            screensBySourcePath.set(re.sourcePath, {
              path,
              componentName,
              sourcePath: re.sourcePath,
              source: re.source,
              endpoints,
              uiActions: [],
            });
          } else {
            const existing = screensBySourcePath.get(re.sourcePath)!;
            existing.path = path;
            existing.componentName = componentName;
            existing.endpoints = endpoints;
          }
        }
        for (const ua of uiActions) {
          const sourcePath = ua.sourcePath;
          const screen = screensBySourcePath.get(sourcePath);
          if (screen) {
            screen.uiActions.push({ title: ua.title, sourcePath: ua.sourcePath, source: ua.source });
          } else {
            screensBySourcePath.set(sourcePath, {
              path: sourcePath,
              componentName: "",
              sourcePath,
              source: ua.source,
              endpoints: [],
              uiActions: [{ title: ua.title, sourcePath: ua.sourcePath, source: ua.source }],
            });
          }
        }
        const screens = Array.from(screensBySourcePath.values());
        const text = formatGetFlow(topic, screens);
        return { content: [{ type: "text" as const, text }] };
      }

      if (name === "cortex_export_openapi") {
        const serviceId = typeof a.serviceId === "string" ? a.serviceId.trim() || undefined : undefined;
        const topic = typeof a.topic === "string" ? a.topic.trim() || undefined : undefined;
        const format = (a.format === "yaml" ? "yaml" : "json") as "json" | "yaml";
        const outputPathRaw = typeof a.outputPath === "string" ? a.outputPath.trim() || undefined : undefined;

        let contracts: MemoryEntry[];
        let title: string;
        let suggestedFileName: string;
        let serviceIdForInstructions: string;

        if (serviceId) {
          contracts = findContracts(serviceId);
          title = `${serviceId} (mock)`;
          suggestedFileName = `cortex-mocks/${serviceId}.json`;
          serviceIdForInstructions = serviceId;
        } else if (topic) {
          contracts = findContracts(undefined, topic);
          title = `Flujo "${topic}" (mock)`;
          suggestedFileName = `cortex-mocks/flujo-${topic.replace(/\s+/g, "-")}.json`;
          serviceIdForInstructions = `flujo-${topic}`;
        } else {
          const all = getMemory().filter((e) => e.kind === "contract");
          const sources = [...new Set(all.map((e) => e.source))].sort();
          const text =
            sources.length === 0
              ? "No hay contratos indexados. Ejecutá **cortex_refresh** y volvé a intentar."
              : `Indicá **serviceId** (ej. \`ms-application\`) o **topic** (ej. \`committee\`) para generar el OpenAPI. Servicios con contratos indexados: ${sources.join(", ")}.`;
          return { content: [{ type: "text" as const, text }] };
        }

        if (contracts.length === 0) {
          const msg = serviceId
            ? `No hay contratos indexados para **${serviceId}**. Ejecutá cortex_refresh o revisá el nombre del servicio.`
            : `No hay contratos que coincidan con el tema **${topic}**. Probá otro topic o un serviceId concreto.`;
          return { content: [{ type: "text" as const, text: msg }], isError: true };
        }

        const responseSchemaEntries = findAllResponseSchemas();
        const responseSchemas = new Map<string, ResponseSchemaShape>();
        for (const e of responseSchemaEntries) {
          const typeName = (e.meta?.typeName as string) ?? e.title;
          const properties = (e.meta?.properties as { name: string; type: string }[]) ?? [];
          responseSchemas.set(typeName, { typeName, properties });
        }

        const openApi = buildOpenApiFromContracts(
          contracts,
          {
            title,
            version: "1.0.0",
            description: "Generado por CORTEX desde el código. Sin datos sensibles. Usá con Prism para mockear y validar requests.",
          },
          responseSchemas
        );

        const portIndex = 0;
        const instructions = buildMockInstructions(serviceIdForInstructions, portIndex, suggestedFileName);

        const body = JSON.stringify(openApi, null, 2);
        const formatNote =
          format === "yaml"
            ? "\n(Nota: por ahora la salida es JSON; Prism y la mayoría de herramientas aceptan JSON. Si necesitás YAML podés convertirlo externamente.)\n\n"
            : "";

        let writtenPath: string | undefined;
        if (outputPathRaw) {
          const workspaceRoot = getWorkspaceRoot();
          if (outputPathRaw.includes("..") || path.isAbsolute(outputPathRaw)) {
            return {
              content: [{ type: "text" as const, text: `**outputPath** debe ser una ruta relativa dentro del workspace (sin \`..\`). Rechazado: \`${outputPathRaw}\`.` }],
              isError: true,
            };
          }
          const resolved = path.resolve(workspaceRoot, outputPathRaw);
          const rel = path.relative(workspaceRoot, resolved);
          if (rel.startsWith("..") || path.isAbsolute(rel)) {
            return {
              content: [{ type: "text" as const, text: `**outputPath** debe estar dentro del workspace. Rechazado: \`${outputPathRaw}\`.` }],
              isError: true,
            };
          }
          try {
            const dir = path.dirname(resolved);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(resolved, body, "utf-8");
            writtenPath = path.relative(workspaceRoot, resolved);
          } catch (err) {
            return {
              content: [{ type: "text" as const, text: `No se pudo escribir en \`${outputPathRaw}\`: ${String(err)}` }],
              isError: true,
            };
          }
        }

        const writtenNote = writtenPath ? `\n\nArchivo escrito en: \`${writtenPath}\`.` : "";
        const text = `## OpenAPI (${format})\n\n${formatNote}Guardá el siguiente contenido en \`${suggestedFileName}\` (o el path que prefieras):\n\n\`\`\`json\n${body}\n\`\`\`\n\n${instructions}${writtenNote}`;
        return { content: [{ type: "text" as const, text }] };
      }

      if (name === "cortex_list_running_mocks") {
        const all = getMemory().filter((e) => e.kind === "contract");
        const serviceIds = [...new Set(all.map((e) => e.source))].sort();
        if (serviceIds.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No hay contratos indexados; no hay puertos de mock asignados. Ejecutá **cortex_refresh** para indexar servicios." }],
          };
        }
        // Una ruta que exista en el spec por servicio, para no hacer GET / (Prism la marca como error)
        const pathByService = new Map<string, string>();
        for (const c of all) {
          const sid = c.source;
          if (!pathByService.has(sid)) {
            const p = (c.meta?.fullPath as string) ?? "";
            pathByService.set(sid, p.startsWith("/") ? p : "/" + p);
          }
        }
        const results: { serviceId: string; port: number; running: boolean }[] = [];
        const timeoutMs = 2000;
        for (let i = 0; i < serviceIds.length; i++) {
          const port = getMockPort(i);
          const sid = serviceIds[i];
          const probePath = pathByService.get(sid) || "/";
          let running = false;
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            await fetch(`http://127.0.0.1:${port}${probePath}`, { signal: controller.signal });
            clearTimeout(timeout);
            running = true;
          } catch {
            // ECONNREFUSED, timeout, etc. → no responde
          }
          results.push({ serviceId: sid, port, running });
        }
        const runningList = results.filter((r) => r.running);
        const notRunningList = results.filter((r) => !r.running);
        let text = "";
        if (runningList.length > 0) {
          text += "**Servicios mockeados (levantados):** " + runningList.map((r) => r.serviceId + " (puerto " + r.port + ")").join(", ") + ".\n\n";
        }
        if (notRunningList.length > 0) {
          text += "**No responden en su puerto:** " + notRunningList.map((r) => r.serviceId + " (" + r.port + ")").join(", ") + ".";
        }
        if (!text) text = "Ningún servicio con contratos indexados; ejecutá **cortex_refresh** si acabás de indexar.";
        return { content: [{ type: "text" as const, text: text.trim() }] };
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
