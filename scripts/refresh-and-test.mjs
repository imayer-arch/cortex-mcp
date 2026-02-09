#!/usr/bin/env node
/**
 * Ejecuta cortex_refresh (full) y prueba las nuevas herramientas.
 * Uso: desde cortex-mcp, con WORKSPACE_ROOT en env.
 * node scripts/refresh-and-test.mjs
 */
const path = await import("path");
const { fileURLToPath, pathToFileURL } = await import("url");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const workspaceRoot = process.env.WORKSPACE_ROOT || path.resolve(root, "..");

process.env.WORKSPACE_ROOT = workspaceRoot;

const indexerUrl = pathToFileURL(path.join(root, "dist/indexer.js")).href;
const storeUrl = pathToFileURL(path.join(root, "dist/memory/store.js")).href;

const { refreshMemory } = await import(indexerUrl);
const { getMemory, findEndpointMapping, getCallersOfPath } = await import(storeUrl);

console.log("WORKSPACE_ROOT:", workspaceRoot);
console.log("Refreshing (forceFull=true)...");
const entries = refreshMemory(true);
console.log("Indexed", entries.length, "entries");

const mapping = findEndpointMapping(undefined, undefined);
console.log("\nEndpoint mappings:", mapping.length);

const callers = getCallersOfPath("application");
console.log("\nWho calls path 'application':", callers.length, "call(s)");

const mem = getMemory();
const contracts = mem.filter((e) => e.kind === "contract").length;
const deps = mem.filter((e) => e.kind === "dependency" || e.kind === "endpoint_mapping").length;
console.log("\nSummary: contracts", contracts, "| deps/endpoint_mapping", deps);
console.log("\nOK — CORTEX listo para usar en Cursor.");
process.exit(0);
