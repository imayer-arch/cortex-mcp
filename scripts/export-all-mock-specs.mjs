/**
 * Exporta OpenAPI de todos los servicios con contratos en la caché de CORTEX
 * a cortex-mocks/<serviceId>.json (en WORKSPACE_ROOT).
 * Uso: WORKSPACE_ROOT=/path/to/Projects node scripts/export-all-mock-specs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// Cargar caché directamente para no depender del runtime de CORTEX
const cachePath = process.env.WORKSPACE_ROOT
  ? path.join(process.env.WORKSPACE_ROOT, ".cortex-cache", "index.json")
  : path.join(root, "..", ".cortex-cache", "index.json");

if (!fs.existsSync(cachePath)) {
  console.error("No cache at", cachePath, "- run cortex_refresh first and set WORKSPACE_ROOT");
  process.exit(1);
}

const workspaceRoot = path.dirname(path.dirname(cachePath));
const outDir = path.join(workspaceRoot, "cortex-mocks");

const raw = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
const entries = raw?.entries ?? [];
const contracts = entries.filter((e) => e.kind === "contract");
const serviceIds = [...new Set(contracts.map((c) => c.source))].sort();

function normalizePath(p) {
  const s = (p || "").trim();
  return s.startsWith("/") ? s : "/" + s;
}

function buildOpenApiFromContracts(contractsList, options) {
  const paths = {};
  for (const c of contractsList) {
    const method = ((c.meta?.method ?? "GET") + "").toLowerCase();
    const fullPath = (c.meta?.fullPath ?? "") + "";
    const pathKey = normalizePath(fullPath);
    const requestBodyType = c.meta?.requestBodyType;
    const responseType = c.meta?.responseType;
    const handlerName = c.meta?.handlerName;
    if (!paths[pathKey]) paths[pathKey] = {};
    const op = {
      summary: (c.meta?.method ?? "GET") + " " + fullPath,
      description: [c.content, handlerName ? "Handler: " + handlerName : ""].filter(Boolean).join(" ").slice(0, 500),
      responses: {
        "200": {
          description: "OK",
          content: {
            "application/json": {
              schema: responseType ? { type: "object", description: "Response type: " + responseType } : { type: "object" },
              ...(responseType ? { example: { responseType } } : {}),
            },
          },
        },
        "422": { description: "Request no coincide con el contrato (validación)." },
      },
    };
    if (requestBodyType && ["post", "put", "patch"].includes(method)) {
      op.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", description: "El servicio espera: " + requestBodyType },
          },
        },
      };
    }
    paths[pathKey][method] = op;
  }
  return {
    openapi: "3.0.0",
    info: {
      title: options.title,
      version: options.version ?? "1.0.0",
      description: options.description ?? "Generado por CORTEX desde el código. Sin datos sensibles.",
    },
    paths,
  };
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (const sid of serviceIds) {
  const list = contracts.filter((c) => c.source === sid);
  const openApi = buildOpenApiFromContracts(list, { title: sid + " (mock)" });
  const outPath = path.join(outDir, sid + ".json");
  fs.writeFileSync(outPath, JSON.stringify(openApi, null, 2), "utf-8");
  console.log("Written", outPath);
}

console.log("Done. Services:", serviceIds.join(", "));
