/**
 * Genera OpenAPI 3.0 desde contratos indexados por CORTEX.
 * Dinámico: no contiene datos sensibles; todo sale del índice (código).
 */

import type { MemoryEntry } from "./memory/types.js";

export interface OpenApiOptions {
  title: string;
  version?: string;
  description?: string;
}

export interface ResponseSchemaShape {
  typeName: string;
  properties: { name: string; type: string }[];
}

const MAX_EXAMPLE_DEPTH = 2;

/**
 * Genera un objeto example a partir de un schema (propiedades con tipo).
 * Tipos: number → 42, string → "string" (o ISO date para from/to), boolean → true, object → recursión.
 */
export function generateExampleFromSchema(
  schema: ResponseSchemaShape,
  allSchemas: Map<string, ResponseSchemaShape>,
  depth: number
): Record<string, unknown> {
  if (depth > MAX_EXAMPLE_DEPTH) return {};
  const out: Record<string, unknown> = {};
  for (const prop of schema.properties) {
    const t = prop.type.toLowerCase();
    if (t === "number") out[prop.name] = 42;
    else if (t === "string") {
      const n = prop.name.toLowerCase();
      if (n === "from" || n === "to" || n === "date") out[prop.name] = "2024-01-01";
      else if (n === "bureaucode") out[prop.name] = "NOSIS";
      else out[prop.name] = "string";
    } else if (t === "boolean") out[prop.name] = true;
    else if (t === "object") out[prop.name] = {};
    else {
      const ref = allSchemas.get(prop.type) ?? allSchemas.get(prop.type.replace(/\[\]$/, ""));
      if (ref) out[prop.name] = generateExampleFromSchema(ref, allSchemas, depth + 1);
      else out[prop.name] = prop.type.includes("[]") ? [] : {};
    }
  }
  return out;
}

function normalizePath(p: string): string {
  const s = (p || "").trim();
  return s.startsWith("/") ? s : "/" + s;
}

/** Extrae segmentos :param del path para parameters (path). */
function pathParamsFromPath(fullPath: string): { name: string; in: "path"; required: true; schema: { type: "string" } }[] {
  const params: { name: string; in: "path"; required: true; schema: { type: "string" } }[] = [];
  const segments = fullPath.split("/").filter(Boolean);
  for (const seg of segments) {
    if (seg.startsWith(":")) params.push({ name: seg.slice(1), in: "path", required: true, schema: { type: "string" } });
  }
  return params;
}

/** Query params conocidos por fragmento de path (validación quirúrgica). */
function queryParamsForPath(fullPath: string): { name: string; in: "query"; required?: boolean; schema: { type: "string" } }[] {
  const pathLower = fullPath.toLowerCase();
  if (pathLower.includes("bureau-calls") || pathLower.includes("dashboard/bureau")) {
    return [
      { name: "bureauCode", in: "query", required: true, schema: { type: "string" } },
      { name: "from", in: "query", required: true, schema: { type: "string" } },
      { name: "to", in: "query", required: true, schema: { type: "string" } },
    ];
  }
  return [];
}

/**
 * Construye un objeto OpenAPI 3.0 a partir de entradas kind "contract".
 * Incluye schemas y examples cuando hay responseSchemas; query/path parameters y requestBody para validación quirúrgica.
 */
export function buildOpenApiFromContracts(
  contracts: MemoryEntry[],
  options: OpenApiOptions,
  responseSchemas?: Map<string, ResponseSchemaShape>
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const schemasMap = responseSchemas ?? new Map<string, ResponseSchemaShape>();

  for (const c of contracts) {
    if (c.kind !== "contract") continue;
    const method = ((c.meta?.method as string) ?? "GET").toLowerCase();
    const fullPath = (c.meta?.fullPath as string) ?? "";
    const pathKey = normalizePath(fullPath);
    const requestBodyType = c.meta?.requestBodyType as string | undefined;
    const responseType = c.meta?.responseType as string | undefined;
    const handlerName = c.meta?.handlerName as string | undefined;

    if (!paths[pathKey]) paths[pathKey] = {};

    const pathParams = pathParamsFromPath(fullPath);
    const queryParams = method === "get" ? queryParamsForPath(fullPath) : [];
    const parameters = [
      ...pathParams.map((p) => ({ ...p, description: `Path: ${p.name}` })),
      ...queryParams.map((q) => (q.required ? { ...q, description: `Requerido: ${q.name}` } : q)),
    ];

    let example: Record<string, unknown> | undefined;
    const responseSchema = responseType ? schemasMap.get(responseType) : undefined;
    if (responseSchema) {
      example = generateExampleFromSchema(responseSchema, schemasMap, 0);
    }

    const op: Record<string, unknown> = {
      summary: `${(c.meta?.method as string) ?? "GET"} ${fullPath}`,
      description: [c.content, handlerName ? `Handler: ${handlerName}` : ""].filter(Boolean).join(" ").slice(0, 500),
      ...(parameters.length > 0 ? { parameters } : {}),
      responses: {
        "200": {
          description: "OK",
          content: {
            "application/json": {
              schema: responseType
                ? { type: "object", description: `Response type: ${responseType}` }
                : { type: "object" },
              ...(example ? { example } : responseType ? { example: { responseType } } : {}),
            },
          },
        },
        "422": {
          description: "Request no coincide con el contrato (validación). Revisá body y parámetros.",
        },
      },
    };

    if (requestBodyType && ["post", "put", "patch"].includes(method)) {
      op.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              description: `El servicio espera: ${requestBodyType}`,
              properties: {},
            },
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
      description: options.description ?? "Generado por CORTEX desde contratos indexados del código. Sin datos sensibles.",
    },
    paths,
  };
}

/** Puerto base para mocks (Prism). Servicio en índice i usa puerto MOCK_BASE_PORT + i. */
export const MOCK_BASE_PORT = 4010;

export function getMockPort(portIndex: number): number {
  return MOCK_BASE_PORT + portIndex;
}

/**
 * Genera texto con instrucciones para levantar el mock (Prism) y apuntar el cliente.
 * Sin datos sensibles; solo IDs de servicio y puertos sugeridos.
 */
export function buildMockInstructions(
  serviceId: string,
  portIndex: number,
  suggestedFileName: string
): string {
  const port = getMockPort(portIndex);
  const lines = [
    `### Cómo levantar el mock de **${serviceId}**`,
    "",
    "1. Guardá el OpenAPI de arriba en un archivo, por ejemplo:",
    `   \`${suggestedFileName}\``,
    "",
    "2. Ejecutá el mock (Prism valida el request contra el contrato):",
    `   \`npx prism mock ${suggestedFileName} --port ${port} --validate-request\``,
    "",
    "3. **Cómo apuntar el front al mock:**",
    "   - Si tu front usa **variable de entorno** para la base URL del API (ej. Vite: `VITE_API_URL`, React: `REACT_APP_API_URL`), creá o editá `.env.local` y poné:",
    `     \`<TU_VAR>=http://localhost:${port}\``,
    "   - Si tu front usa **proxy** en el dev server (ej. en vite.config o webpack: las rutas `/v1/...` se reenvían al backend), cambiá el target del proxy a:",
    `     \`http://localhost:${port}\``,
    "   Así las llamadas del front van al mock en vez del servicio real. No hace falta tocar código; solo la config o el .env.",
    "",
    "Si el request no cumple el contrato, el mock responde con 422 y detalle en el body (DevTools → Network → Response).",
  ];
  return lines.join("\n");
}
