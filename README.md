# CORTEX — El córtex de tu workspace

**CORTEX** es un MCP (Model Context Protocol) que actúa como **capa de memoria** de tu workspace: indexa documentación (READMEs, ADRs, docs), decisiones (post-mortems) y **código** (rutas, contratos, dependencias entre repos, mapeo endpoint→servicio, env, glosario, convenciones, tablas DB, changelog). Todo eso queda en un **índice en memoria** (y opcionalmente persistido en disco). Las herramientas de CORTEX consultan ese índice y responden con evidencia y enlaces a archivos — sin volver a escanear el filesystem en cada pregunta.

Es **dinámico**: no asume nombres de repos ni servicios; se adapta a cualquier workspace según los repos que existan bajo `WORKSPACE_ROOT`. **No almacena ni expone datos sensibles**: solo indexa estructura, contratos y documentación del código.

**CORTEX no depende de ningún otro MCP ni servicio externo:** solo usa el filesystem (`WORKSPACE_ROOT`) y sus propias dependencias. Podés usarlo solo o junto con otros MCPs; nunca los llama ni los requiere.

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

### Búsqueda por embeddings (opcional)

Para mejorar **cortex_ask_why** con búsqueda semántica (similitud coseno sobre vectores), instalá la dependencia opcional y activá con env:

- `npm install` (incluye `optionalDependencies`: `@xenova/transformers`)
- En la config MCP, en `env`: **CORTEX_EMBED=1** (o `true`). Sin esto se usa búsqueda por términos (siempre disponible).

- **CORTEX_DEBUG=1**: opcional; escribe en consola un resumen del indexado (ej. cantidad de entradas por workspace).

## Instalación

```bash
cd cortex-mcp
npm install
npm run build
npm test   # opcional: tests de discovery, store y persistence
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
        "WORKSPACE_ROOT": "C:/ruta/a/tus/Projects",
        "CORTEX_EMBED": "1",
        "CORTEX_DEBUG": "0"
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
| **cortex_export_endpoints** | Exporta contratos y mapeo en JSON (para documentación, scripts o comparación manual con otras fuentes). |
| **cortex_export_openapi** | Exporta OpenAPI 3.0 desde los contratos indexados para **mockear** servicios sin levantarlos. Opcional: `serviceId`, `topic`, `outputPath` (escribe el JSON en ese path dentro del workspace). Genera **examples** desde tipos del front (response_schema) cuando el contrato tiene responseType. Incluye instrucciones para Prism con validación (404/422 quirúrgico). Sin datos sensibles. |
| **cortex_list_running_mocks** | Indica **qué servicios mockeados están levantados**: consulta los puertos que CORTEX asigna a cada servicio (4010, 4011, …) y devuelve cuáles responden. Útil para preguntas como «qué mocks tengo» o «qué servicios están mockeados». |

### Cómo activar / levantar los servicios (mock)

CORTEX **descubre** los servicios y microservicios del workspace a partir del código (contratos indexados). En lugar de levantar cada proceso (que suele ser lento y pesado), podés **levantar un mock** que simula las respuestas y valida lo que envía el front:

1. **Consultar qué servicios hay:** Llamá **cortex_export_openapi** sin parámetros: CORTEX te lista los servicios con contratos indexados (ej. ms-application, bff-moor).
2. **Exportar OpenAPI de un servicio o flujo:** Llamá **cortex_export_openapi** con `serviceId: "ms-application"` o con `topic: "committee"`. CORTEX devuelve el OpenAPI (JSON) y las **instrucciones** para levantar el mock.
3. **Levantar el mock:** Guardá el OpenAPI en un archivo (ej. `cortex-mocks/ms-application.json`) y ejecutá el comando que indica CORTEX (ej. `npx prism mock cortex-mocks/ms-application.json --port 4010 --validate-request`). Eso levanta **un solo proceso** que responde a las mismas rutas que el servicio real y **valida** el request: si el front envía un body que no coincide con el contrato, el mock responde con error (422) y detalle en el body (visible en DevTools → Network o en Postman).
4. **Apuntar el front al mock:** El front tiene que enviar las requests al puerto del mock en vez del backend real. Según cómo esté armado el proyecto:
   - **Si usa variable de entorno** para la base URL del API (ej. Vite: `VITE_API_URL`, React: `REACT_APP_API_URL`), creá o editá `.env.local` en el repo del front y poné esa variable apuntando al mock, ej. `VITE_API_URL=http://localhost:4010`. Reiniciá el dev server del front para que tome el cambio.
   - **Si usa proxy** en el dev server (vite.config, webpack, etc.) para reenviar rutas tipo `/v1/...` al backend, cambiá el `target` del proxy a `http://localhost:4010` (o el puerto que indique CORTEX). Así las llamadas del front pasan por el proxy y llegan al mock.
   En ambos casos **no hace falta tocar código**; solo la config o el `.env`. Las mismas URLs relativas (ej. `/v1/private/applications`) terminan yendo al mock.
5. **Consultar qué mocks están levantados:** Llamá **cortex_list_running_mocks**: CORTEX consulta los puertos 4010, 4011, … (asignados a cada servicio con contratos) y te dice cuáles responden (ej. «ms-application (4010) levantado; bff-moor (4011) no responde»).

Así **activás** los servicios necesarios en forma de mock, sin deploy ni levantar los microservicios/servicios reales. Todo lo que usa CORTEX sale del **índice** (código); no se incluyen datos sensibles.

### Memoria persistente e incremental

- **cortex_refresh trabaja a nivel de workspace:** un solo **cortex_refresh** recorre **todos** los repos bajo **WORKSPACE_ROOT** (la carpeta que contiene bff-moor, movil-front, ms-application, etc.) y reindexa docs y código de todos. No hace falta ejecutarlo por repo.
- Al hacer **cortex_refresh**, el índice se guarda en **`.cortex-cache/index.json`** dentro del workspace. Al arrancar el MCP se carga ese caché; no hace falta reindexar cada vez.
- Si los repos no cambiaron (por mtime), **cortex_refresh** usa el caché (refresh incremental). Usá **forceFull: true** para reindexar siempre.

### Workspace dinámico

- CORTEX no asume ramas ni nombres de repos: indexa lo que hay en **WORKSPACE_ROOT** en el momento del **cortex_refresh**. Si cambiás de rama o agregás endpoints nuevos, ejecutá **cortex_refresh** para que aparezcan en búsquedas y **cortex_get_context**.
- Los contratos (endpoints) son buscables por **path**, **nombre del handler** (ej. `getBureauCallsStats`) y **palabras derivadas** (bureau, calls, stats), así consultas como "bureau calls" o "contador nosis" pueden encontrar el endpoint correcto si el path o el handler lo reflejan.

### Advertencias en get_context

- Si el repo es llamado por varios servicios o aparece en post-mortems/ADRs, **cortex_get_context** muestra una sección ⚠️ Advertencias.

## Qué indexa CORTEX

### Documentación (como antes)

- **README.md** en la raíz de cada repo
- **docs/*.md** dentro de cada repo
- **ADR*.md** en la raíz o en **docs/adr/*.md**

### Código (nuevo, fuente de verdad)

- **Contratos entre servicios:** Rutas expuestas por cada repo (buscables por path, nombre del handler y palabras derivadas, ej. "bureau", "calls"):
  - **NestJS/Express:** `@Controller`, `@Get`/`@Post`/etc. con método, path, body/response type y nombre del handler.
  - **Spring Boot (Kotlin/Java):** `@RestController`, `@GetMapping`/`@PostMapping`/etc. en `src/main/kotlin` o `src/main/java`. Detección por `build.gradle.kts`, `build.gradle` o `pom.xml` con spring-boot.
  - **Go (chi, echo, gin, gorilla/mux):** Rutas en `cmd`, `internal`, `pkg`, `api` (`.Get("/path", ...)`, `.HandleFunc`, etc.). Detección por `go.mod` o `main.go`/`cmd`.
- **Índice "qué hace este repo":** Por repo: descripción, cantidad de rutas, a qué servicios llama, variables de entorno. Generado desde código, no desde README.
- **Dependencias entre repos:** Uso de `configService.get('X_HOST')` y clientes HTTP (axios) en Node; en Spring: `RestTemplate`/`WebClient` con base URL desde `@Value("${...}")`.
- **Mapeo endpoint → servicio:** En Node: `createAxiosInstance` + `configService.get('...')`. En Spring: `RestTemplate`/`WebClient` con URL de config. Es **dinámico**: no hay nombres de repo fijos; el destino se resuelve por variable de env/config y por los IDs de repos del workspace. Este mapeo aparece en **cortex_get_context** (por repo) y en **cortex_get_endpoint_mapping** (opcional: filtrar por `fromRepo` o `toService`).
- **Glosario de dominios:** Términos extraídos de paths (applications, guarantees, origination) y de DTOs/types en controladores.
- **Patrones y convenciones:** Detección de uso de Idempotency-Key, @UseGuards, @Roles en el código.
- **Contexto por tabla/dominio (DB):** En **moor-sql**, indexación de tablas (CREATE TABLE / ALTER TABLE) con archivo y repo.
- **Variables de entorno y config:** Por repo: variables usadas en `.env.example` y en código (`process.env.X`, `configService.get('X')`). En `get_context` se muestra "este servicio necesita X, Y, Z".
- **Changelog / hitos:** Contenido de **CHANGELOG.md** por repo (versiones, conventional commits, BREAKING).
- **Rutas y pantallas del front (React):** En repos tipo "front", se indexan rutas desde `routePaths` + `Routes`: path, componente y archivo (ej. `/configuracion` → Settings, `src/pages/Settings.tsx`). Así **cortex_how_to** ("configuración") puede devolver la pantalla correcta.
- **Uso de endpoints en el front:** Se indexa qué archivos importan servicios (ej. `BureauDashboardService`) o usan URLs de API (`/v1/private/...`), para preguntas tipo "¿dónde se usa bureau-calls?".

Todo lo anterior se obtiene **directamente del código**; no depende de documentación actualizada.

### Búsqueda mejorada (estilo semántico)

- Las consultas (**cortex_ask_why**, **cortex_get_context**, etc.) usan una búsqueda por términos con **tokenización**, **normalización de plurales y sufijos** (p. ej. "pagos" → "pago") y **scoring** por título, contenido y tags. Así preguntas como "por qué hacemos pagos idempotentes" encuentran mejor contenido relacionado aunque no uses las mismas palabras exactas.

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

**Hecho por Ivan Meyer ([imayer-arch](https://github.com/imayer-arch))** —
