/**
 * Tipos de evidencia que CORTEX indexa y recuerda.
 */
export type MemoryKind =
  | "adr"
  | "readme"
  | "doc"
  | "code_landmark"
  | "post_mortem"
  | "repo_summary"
  | "contract"
  | "dependency"
  | "glossary"
  | "convention"
  | "env_config"
  | "db_table"
  | "changelog"
  | "endpoint_mapping"
  | "front_route"
  | "front_endpoint_usage"
  | "service_endpoint"
  | "ui_action"
  | "route_endpoints"
  | "response_schema";

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  /** Repo o servicio (ej. bff-moor, ms-application) */
  source: string;
  /** Ruta relativa al workspace o absoluta */
  sourcePath: string;
  /** Título o nombre (ej. título del ADR, nombre del endpoint) */
  title: string;
  /** Resumen o contenido indexable (para búsqueda) */
  content: string;
  /** Contenido completo si es corto; si no, undefined */
  fullContent?: string;
  /** Etiquetas o temas (ej. ["pagos", "idempotencia", "incident"]) */
  tags: string[];
  /** Referencias a otros (ej. "ADR-07", "ticket #4521") */
  references: string[];
  /** Línea aproximada si aplica */
  line?: number;
  /** Datos estructurados para contratos, deps, env, etc. */
  meta?: Record<string, unknown>;
  /** Vector de embedding para búsqueda semántica (opcional). */
  embedding?: number[];
}

export interface CortexContext {
  entries: MemoryEntry[];
  /** Respuesta en lenguaje natural sugerida */
  summary?: string;
}
