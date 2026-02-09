import path from "node:path";
import type { MemoryEntry } from "../memory/types.js";
import { discoverRepos } from "./discovery.js";
import { extractNestRoutes, type RouteInfo } from "./routes.js";
import { collectEnvVars } from "./env.js";
import { extractServiceCalls } from "./dependencies.js";
import { extractOutboundMappings, type OutboundCall } from "./outbound-calls.js";
import { extractOutboundSpringMappings } from "./outbound-spring.js";
import { extractSpringRoutes } from "./routes-spring.js";
import { extractGoRoutes } from "./routes-go.js";
import { glossaryFromRoutes } from "./glossary.js";
import { extractConventions } from "./conventions.js";
import { extractTablesFromSqlRepo } from "./db.js";
import { extractChangelog } from "./changelog.js";

function slug(repo: string, suffix: string): string {
  return `${repo}:${suffix}`.replace(/\//g, ":").slice(0, 150);
}

function toEntry(
  kind: MemoryEntry["kind"],
  source: string,
  sourcePath: string,
  title: string,
  content: string,
  tags: string[] = [],
  meta?: Record<string, unknown>,
  line?: number
): MemoryEntry {
  return {
    id: slug(source, title + ":" + sourcePath),
    kind,
    source,
    sourcePath,
    title,
    content,
    tags,
    references: [],
    meta,
    line,
  };
}

export function indexCode(workspaceRoot: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  const repos = discoverRepos(workspaceRoot);
  const repoIds = repos.map((r) => r.id);

  for (const repo of repos) {
    if (repo.type === "sql") {
      const tables = extractTablesFromSqlRepo(repo.absolutePath, workspaceRoot);
      for (const t of tables) {
        entries.push(
          toEntry(
            "db_table",
            repo.id,
            t.filePath,
            t.schema ? `${t.schema}.${t.tableName}` : t.tableName,
            `Tabla ${t.tableName} (${t.operation}) en ${t.filePath}. Repo: ${repo.id}.`,
            [t.operation.toLowerCase(), "sql", repo.id],
            { tableName: t.tableName, schema: t.schema, operation: t.operation },
            undefined
          )
        );
      }
      const changelogEntries = extractChangelog(repo.absolutePath);
      for (const ch of changelogEntries) {
        entries.push(
          toEntry(
            "changelog",
            repo.id,
            "CHANGELOG.md",
            ch.version || "Changelog",
            ch.content,
            ["changelog", ...(ch.isBreaking ? ["breaking"] : [])],
            { version: ch.version, isBreaking: ch.isBreaking },
            undefined
          )
        );
      }
      continue;
    }

    if (repo.type === "nestjs" || repo.type === "express" || repo.type === "spring" || repo.type === "go") {
      const routes =
        repo.type === "nestjs"
          ? extractNestRoutes(repo, workspaceRoot)
          : repo.type === "spring"
            ? extractSpringRoutes(repo, workspaceRoot)
            : repo.type === "go"
              ? extractGoRoutes(repo, workspaceRoot)
              : [];
      const envVars = collectEnvVars(repo.absolutePath);
      const calls =
        repo.type === "spring" || repo.type === "go"
          ? []
          : extractServiceCalls(repo.absolutePath, repo.id, workspaceRoot, repoIds);
      const outboundMappings =
        repo.type === "spring"
          ? extractOutboundSpringMappings(repo.absolutePath, repo.id, workspaceRoot, repoIds)
          : repo.type === "go"
            ? []
            : extractOutboundMappings(repo.absolutePath, repo.id, workspaceRoot, repoIds);
      const conventions = extractConventions(repo.absolutePath, repo.id, workspaceRoot);
      const glossaryTerms = glossaryFromRoutes(repo.id, routes, repo.controllersPath);

      // Aggregate outbound calls by (fromRepo, toService) and store as endpoint_mapping
      const byTarget = new Map<string, { envVar: string; filePaths: string[]; calls: OutboundCall[] }>();
      for (const om of outboundMappings) {
        const key = `${repo.id}\t${om.toService}`;
        const existing = byTarget.get(key);
        if (!existing) {
          byTarget.set(key, { envVar: om.envVar, filePaths: [om.filePath], calls: [...om.calls] });
        } else {
          if (!existing.filePaths.includes(om.filePath)) existing.filePaths.push(om.filePath);
          const seen = new Set(existing.calls.map((c) => c.method + ":" + ("literal" in c.path ? c.path.literal : c.path.pathKey)));
          for (const c of om.calls) {
            const k = c.method + ":" + ("literal" in c.path ? c.path.literal : c.path.pathKey);
            if (!seen.has(k)) {
              seen.add(k);
              existing.calls.push(c);
            }
          }
        }
      }
      for (const [key, val] of byTarget) {
        const [fromRepo, toService] = key.split("\t");
        const pathList = val.calls
          .slice(0, 80)
          .map((c) => c.method + " " + ("literal" in c.path ? c.path.literal : `[${c.path.pathKey}]`));
        const content = `${fromRepo} llama a ${toService} (env: ${val.envVar}). Endpoints: ${pathList.join(", ")}${val.calls.length > 80 ? "…" : ""}.`;
        entries.push(
          toEntry(
            "endpoint_mapping",
            repo.id,
            val.filePaths[0],
            `${fromRepo} → ${toService}`,
            content,
            [toService, "endpoint-mapping", "http"],
            {
              fromRepo,
              toService,
              envVar: val.envVar,
              filePaths: val.filePaths,
              calls: val.calls.slice(0, 100),
            },
            undefined
          )
        );
      }

      const summaryParts: string[] = [];
      summaryParts.push(repo.description || `${repo.name} (${repo.type})`);
      if (routes.length) summaryParts.push(`Expone ${routes.length} ruta(s): ${routes.slice(0, 5).map((r) => r.method + " " + r.fullPath).join(", ")}${routes.length > 5 ? "…" : ""}.`);
      const toServicesFromCalls = [...new Set(calls.filter((c) => c.toService).map((c) => c.toService as string))];
      const toServicesFromMapping = [...byTarget.keys()].map((k) => k.split("\t")[1]).filter(Boolean);
      const toServices = [...new Set([...toServicesFromCalls, ...toServicesFromMapping])];
      if (toServices.length) summaryParts.push(`Usa: ${toServices.join(", ")}.`);
      if (envVars.length) summaryParts.push(`Env: ${envVars.slice(0, 10).join(", ")}${envVars.length > 10 ? "…" : ""}.`);

      entries.push(
        toEntry(
          "repo_summary",
          repo.id,
          "package.json",
          repo.name,
          summaryParts.join(" "),
          [repo.type, ...toServices],
          { routeCount: routes.length, envVars, toServices },
          undefined
        )
      );

      for (const r of routes) {
        const contractContent = [
          `${repo.id} expone ${r.method} ${r.fullPath}`,
          r.requestBodyType ? `Body: ${r.requestBodyType}` : "",
          r.responseType ? `Response: ${r.responseType}` : "",
        ]
          .filter(Boolean)
          .join(". ");
        const contractId = slug(repo.id, `contract:${r.method}:${r.fullPath}`);
        entries.push({
          ...toEntry(
            "contract",
            repo.id,
            r.filePath,
            `${r.method} ${r.fullPath}`,
            contractContent,
            [r.method.toLowerCase(), ...r.fullPath.split("/").filter(Boolean)],
            {
              method: r.method,
              fullPath: r.fullPath,
              requestBodyType: r.requestBodyType,
              responseType: r.responseType,
              handlerName: r.handlerName,
            },
            r.line
          ),
          id: contractId,
        });
      }

      for (const c of calls.filter((c) => c.toService)) {
        const content = `${repo.id} llama a ${c.toService} (env: ${c.envVar}). ${c.method ? c.method + " " + (c.pathFragment || "") : ""}`.trim();
        entries.push(
          toEntry(
            "dependency",
            repo.id,
            c.filePath,
            `${repo.id} → ${c.toService}`,
            content,
            [c.toService!, "http-client"],
            { fromRepo: repo.id, toService: c.toService, envVar: c.envVar, method: c.method, pathFragment: c.pathFragment },
            undefined
          )
        );
      }

      if (envVars.length) {
        entries.push(
          toEntry(
            "env_config",
            repo.id,
            ".env.example",
            `Variables de entorno — ${repo.id}`,
            `Este servicio usa: ${envVars.join(", ")}.`,
            ["config", "env"],
            { vars: envVars },
            undefined
          )
        );
      }

      for (const g of glossaryTerms) {
        entries.push(
          toEntry(
            "glossary",
            repo.id,
            g.sourcePath,
            g.term,
            `Término de dominio "${g.term}" (${g.kind}) en ${repo.id}.`,
            [g.kind, g.term],
            { kind: g.kind },
            g.line
          )
        );
      }

      for (const c of conventions) {
        entries.push(
          toEntry(
            "convention",
            repo.id,
            c.sourcePath,
            c.name,
            c.description + ` Encontrado en ${c.count} archivo(s).`,
            ["convention", c.name],
            { count: c.count },
            c.line
          )
        );
      }

      const changelogEntries = extractChangelog(repo.absolutePath);
      for (const ch of changelogEntries) {
        entries.push(
          toEntry(
            "changelog",
            repo.id,
            "CHANGELOG.md",
            ch.version || "Changelog",
            ch.content,
            ["changelog", ...(ch.isBreaking ? ["breaking"] : [])],
            { version: ch.version, isBreaking: ch.isBreaking },
            undefined
          )
        );
      }
    }

    if (repo.type === "front" || repo.type === "other") {
      const envVars = collectEnvVars(repo.absolutePath);
      const changelogEntries = extractChangelog(repo.absolutePath);
      if (envVars.length) {
        entries.push(
          toEntry(
            "env_config",
            repo.id,
            ".env.example",
            `Variables de entorno — ${repo.id}`,
            `Este servicio usa: ${envVars.join(", ")}.`,
            ["config", "env"],
            { vars: envVars },
            undefined
          )
        );
      }
      for (const ch of changelogEntries) {
        entries.push(
          toEntry(
            "changelog",
            repo.id,
            "CHANGELOG.md",
            ch.version || "Changelog",
            ch.content,
            ["changelog"],
            { version: ch.version },
            undefined
          )
        );
      }
    }
  }

  return entries;
}
