# CORTEX — La memoria viva del sistema

**CORTEX** es un MCP (Model Context Protocol) que actúa como **capa de memoria** de tu workspace: indexa documentación (READMEs, ADRs, docs), decisiones (post-mortems) y **código** (rutas, contratos, dependencias entre repos, mapeo endpoint→servicio, env, glosario, convenciones, tablas DB, changelog). Todo eso queda en un **índice en memoria** (y opcionalmente persistido en disco). Las herramientas de CORTEX consultan ese índice y responden con evidencia y enlaces a archivos — sin volver a escanear el filesystem en cada pregunta.

Es **dinámico**: no asume nombres de repos ni servicios; se adapta a cualquier workspace según los repos que existan bajo `WORKSPACE_ROOT`.

## ¿Qué hace CORTEX?

- **Indexa** una sola vez (o cuando hacés `cortex_refresh`): recorre los repos, lee docs y código, y arma un índice (contratos, dependencias, quién llama a qué endpoint, env, ADRs, etc.).
- **Persiste** el índice en `.cortex-cache/index.json` y lo carga al arrancar el MCP, para no reindexar en cada sesión.
- **Responde** a preguntas concretas vía herramientas: "por qué está hecho así", "todo sobre este repo", "quién llama a este endpoint", "¿este cambio rompe algo?", "grafo de dependencias", etc. Cada respuesta usa solo el índice (búsquedas y filtros en memoria), no lee archivos otra vez.

La **fuente de verdad** para contratos y dependencias es el **código** (controladores, clientes HTTP, env), no la documentación. Así evitás depender de docs desactualizadas.

## Con CORTEX vs sin CORTEX

| Necesidad | Sin CORTEX | Con CORTEX |
|-----------|------------|------------|
| "¿Por qué decidimos X?" | Buscar a mano en varios repos (ADR*, docs, READMEs). | **cortex_ask_why** con una frase → evidencia con enlaces. |
| "Todo sobre el repo X antes de tocarlo" | Abrir README (si existe y está al día), buscar controladores, .env, quién lo llama. | **cortex_get_context** con el repo → resumen, rutas, dependencias, env, ADRs y, si aplica, advertencias (ej. "lo llaman 3 servicios"). |
| "¿Qué endpoint del BFF llama a qué endpoint del micro?" | Rastrear axios/fetch, variables de env y paths en el código. | **cortex_get_endpoint_mapping** o **cortex_who_calls_endpoint** → lista ya extraída del código. |
| "¿Cómo se hace origination / pagos?" | Pensar en repos, buscar rutas y ADRs a mano. | **cortex_how_to** con el tema → repos, endpoints y decisiones relacionadas. |
| "¿Si cambio o borro este endpoint, quién se rompe?" | Buscar referencias y cruzar con doc. | **cortex_impact_analysis** o **cortex_who_calls_endpoint** → llamadores y contexto. |
| "Diagrama de dependencias entre servicios" | Dibujar a mano o mantener un doc que se desactualiza. | **cortex_export_dependency_graph** (mermaid o dot) → generado desde el índice. |
| "Lista de endpoints para comparar con otra herramienta" | Recorrer código o OpenAPI a mano. | **cortex_export_endpoints** → JSON de contratos y mapeo. |

En resumen: **sin CORTEX** tenés que buscar y cruzar información en muchos repos y archivos cada vez. **Con CORTEX** esa información ya está indexada y las respuestas son una o dos llamadas a herramientas, con evidencia enlazada al código y a la doc.

## Requisitos

- Node.js >= 18
- Variable de entorno **WORKSPACE_ROOT** apuntando a la carpeta que contiene tus repos (ej. bff-moor, ms-application, moor-sql, …)

## Instalación

```bash
cd cortex-mcp
npm install
npm run build
```

## Uso en Cursor

En la config MCP (ej. `%APPDATA%\Cursor\User\globalStorage\cursor.mcp\mcp.json` o `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["C:/ruta/a/cortex-mcp/dist/index.js"],
      "env": {
        "WORKSPACE_ROOT": "C:/ruta/a/tus/Projects"
      }
    }
  }
}
```

Reiniciá Cursor o recargá MCP.

## Herramientas

| Herramienta | Descripción |
|-------------|-------------|
| **cortex_refresh** | Reindexa todo: READMEs, docs, ADRs y **código** (rutas, contratos, dependencias entre repos, env, glosario, convenciones, tablas DB, changelog). |
| **cortex_ask_why** | Pregunta o tema. Busca en toda la memoria (doc + código) y devuelve evidencia con enlaces. |
| **cortex_get_context** | Contexto completo sobre un repo, path, endpoint o tema: resumen del repo, contratos (endpoints), dependencias, env, glosario, tablas DB, changelog, ADRs. Ideal antes de tocar código. |
| **cortex_find_decisions** | Lista ADRs y post-mortems. Opcional: filtrar por tema. |
| **cortex_how_to** | Respuesta tipo "cómo se hace X en el workspace": repos involucrados, endpoints (desde código), ADRs y términos de dominio. Ej: origination, pagos, garantías. |
| **cortex_get_endpoint_mapping** | Mapeo dinámico: qué repo llama a qué servicio y con qué endpoints (método + path). Parámetros opcionales: `fromRepo`, `toService`. |
| **cortex_impact_analysis** | ¿Este cambio rompe algo? Indicá repo/path/endpoint; CORTEX cruza contratos, quién llama y ADRs. |
| **cortex_export_dependency_graph** | Grafo de dependencias (quién llama a quién) en formato **mermaid** o **dot**. Dinámico por workspace. |
| **cortex_who_calls_endpoint** | Quién llama a un path: indicá un fragmento (ej. `applications`, `v1/private`). |
| **cortex_export_endpoints** | Exporta contratos y mapeo en JSON para cruzar con otro MCP (ej. movil-workspace-apis). |

### Memoria persistente e incremental

- Al hacer **cortex_refresh**, el índice se guarda en **`.cortex-cache/index.json`** dentro del workspace. Al arrancar el MCP se carga ese caché; no hace falta reindexar cada vez.
- Si los repos no cambiaron (por mtime), **cortex_refresh** usa el caché (refresh incremental). Usá **forceFull: true** para reindexar siempre.

### Advertencias en get_context

- Si el repo es llamado por varios servicios o aparece en post-mortems/ADRs, **cortex_get_context** muestra una sección ⚠️ Advertencias.

## Qué indexa CORTEX

### Documentación (como antes)

- **README.md** en la raíz de cada repo
- **docs/*.md** dentro de cada repo
- **ADR*.md** en la raíz o en **docs/adr/*.md**

### Código (nuevo, fuente de verdad)

- **Contratos entre servicios:** Rutas expuestas por cada repo (NestJS: `@Controller`, `@Get`/`@Post`/etc.) con método, path, body/response type. "bff-moor expone GET v1/private/applications…".
- **Índice "qué hace este repo":** Por repo: descripción, cantidad de rutas, a qué servicios llama, variables de entorno. Generado desde código, no desde README.
- **Dependencias entre repos:** Uso de `configService.get('X_HOST')` y clientes HTTP (axios) para inferir "bff-moor llama a ms-application".
- **Mapeo endpoint → servicio:** En repos que usan `createAxiosInstance` (o similar) con `configService.get('...')` para la baseURL, CORTEX extrae qué servicio llaman y qué endpoints (método + path). Es **dinámico**: no hay nombres de repo fijos; el destino se resuelve por variable de env y por los IDs de repos del workspace. Este mapeo aparece en **cortex_get_context** (por repo) y se puede consultar solo con **cortex_get_endpoint_mapping** (opcional: filtrar por `fromRepo` o `toService`).
- **Glosario de dominios:** Términos extraídos de paths (applications, guarantees, origination) y de DTOs/types en controladores.
- **Patrones y convenciones:** Detección de uso de Idempotency-Key, @UseGuards, @Roles en el código.
- **Contexto por tabla/dominio (DB):** En **moor-sql**, indexación de tablas (CREATE TABLE / ALTER TABLE) con archivo y repo.
- **Variables de entorno y config:** Por repo: variables usadas en `.env.example` y en código (`process.env.X`, `configService.get('X')`). En `get_context` se muestra "este servicio necesita X, Y, Z".
- **Changelog / hitos:** Contenido de **CHANGELOG.md** por repo (versiones, conventional commits, BREAKING).

Todo lo anterior se obtiene **directamente del código**; no depende de documentación actualizada.

## Enlace "todo sobre un endpoint"

Para una pregunta como *"todo sobre POST /origination"*: usá **cortex_get_context** con `identifier: "origination"` (o `"POST /origination"`). CORTEX combina contratos que coincidan con ese path, resumen del repo, ADRs y doc relacionados. La información de endpoints viene del código (controladores), no de OpenAPI externo.

## Hacer este MCP público

1. **Subir el repo a GitHub**
   - Creá un repo nuevo en GitHub (ej. `cortex-mcp`).
   - La URL del repo ya está en `package.json` (ej. `https://github.com/imayer-arch/cortex-mcp.git`). Si usás otro usuario/org, actualizala.
   - Desde la carpeta del proyecto:
     ```bash
     git remote add origin https://github.com/imayer-arch/cortex-mcp.git
     git add .
     git commit -m "Initial public release"
     git push -u origin main
     ```
   - En GitHub: **Settings → General → Danger Zone → Change repository visibility → Public**.

2. **Opcional: publicar en npm**
   - Creá una cuenta en [npmjs.com](https://www.npmjs.com) si no tenés.
   - En la terminal: `npm login`.
   - Revisá que el `name` en `package.json` no esté tomado en npm (si ya existe, usá algo como `@imayer-arch/cortex-mcp`).
   - Ejecutá: `npm publish --access public` (el `--access public` es necesario si el paquete es scoped, ej. `@org/cortex-mcp`).
   - Después otros pueden instalar con `npm install cortex-mcp` y usar en Cursor apuntando a `node_modules/cortex-mcp/dist/index.js`, o con `npx cortex-mcp` si configuraron el bin.

3. **Licencia**
   - El repo incluye **LICENSE** (MIT) para que cualquiera pueda usar, modificar y redistribuir el código.

---

## Roadmap (ideas)

- Índice de commits/autores por archivo ("quién tocó esto")
- Advertencias proactivas al abrir archivos ("este archivo estuvo en 2 post-mortems")
- "Voz" de ADRs: "¿Qué diría el ADR-07 sobre este cambio?"

---

**Hecho por Ivan Meyer ([imayer-arch](https://github.com/imayer-arch))** — CORTEX, el cerebro del producto que no olvida.
