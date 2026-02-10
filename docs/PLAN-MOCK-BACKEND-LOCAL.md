# Plan: Mock del backend en local (sin levantar todos los microservicios)

**Problema:** Varios microservicios y servicios en el workspace; levantarlos todos en local tarda mucho, consume mucha memoria y relentiza la máquina. La única forma de probar cambios en local era subir todo el stack.

**Objetivo:** Que el equipo pueda **mockear** lo que devolvería el back (microservicios y servicios) según el código actual, para desarrollar y probar (front o un solo servicio) **sin correr todos los procesos**.

---

## La “gold idea”

**Si cambiás código en un servicio o microservicio, ya no sería necesario hacer deploy ni levantarlo en local para probar contra ese servicio.**

Flujo:

1. Modificás el código (ej. nuevo endpoint, cambio en el DTO de respuesta) en **ms-application** (o el micro que sea).
2. Ejecutás **cortex_refresh** para que CORTEX reindexe y tome el contrato nuevo.
3. Volvés a exportar OpenAPI (**cortex_export_openapi**) y reiniciás el mock (Prism) con el spec actualizado.
4. El front (o el BFF) sigue apuntando al **mock**; el mock ya refleja la API actual según el código. Probás contra el mock **sin levantar ms-application**.

Así podés iterar en el backend (cambios de contrato, rutas, formas de request/response) y validar del lado del front o de otros consumidores **sin deploy ni levantar ese servicio en local**.

**Aclaración — qué significa "probar" en este plan**

En este plan, **probar** es: **desde el front, enviar datos y ver si se envían bien y si el microservicio/servicio está esperando eso, o si el contrato es distinto.** Es decir: ¿lo que manda el front (body, request) coincide con lo que el contrato del backend espera? Si no coincide, que quede claro el error: "envías X, el micro/servicio espera Y". Eso **lo hace el mock con validación**: el mock recibe lo que envía el front, lo valida contra el OpenAPI (contratos indexados del código) y responde con éxito o con error explicando el desvío. **No hace falta levantar el backend ni correr tests.** Flujo: front envía → mock valida contra contrato → si está mal, mock dice qué está mal. (Lo de "tests del backend" sería solo si quisieras ejecutar reglas de negocio del código del backend; para validar que el front manda bien y que el contrato es el esperado, alcanza con el mock.)

---


---

## La “main gold”: mock que valida y dice qué está mal

La idea fuerte es que el mock no solo **responda** con un ejemplo, sino que **valide** lo que manda el front contra lo que el microservicio/servicio espera (según el código indexado). Si lo que se envía no coincide, el mock responde con **error** y explica el problema.

Ejemplos de lo que el mock podría devolver:

- “Error de request body: enviaste un body con campo `X`, el servicio espera `Y`” (o “espera campos `applicationId`, `status`; faltan o son de tipo incorrecto”).
- “Error de response: el contrato indica que la respuesta tiene forma `Z`; revisá que el front espere eso.”
- Errores de validación estándar: required, type, format, etc.

Así el front (o quien llame) puede **fallar en local** con mensajes claros (“envias X, el micro espera Y”) sin levantar el backend. La implementación es dinámica y se adapta al workspace porque los **schemas de validación** salen del índice de CORTEX (contratos, requestBodyType, responseType, y si se puede, DTOs).

**Cómo lograrlo**

1. **OpenAPI con schemas, no solo ejemplos**  
   CORTEX al exportar OpenAPI debe incluir **schemas** para `requestBody` y para `responses` (formas esperadas). Aunque sea mínimos (ej. “objeto con estas propiedades”), eso permite que un mock con validación sepa “qué espera el servicio”. Si el índice tiene `requestBodyType` / `responseType` o en el futuro DTOs con propiedades, se pueden generar `components.schemas` y referenciarlos en cada operación.

2. **Mock server que valide request (y opcionalmente response)**  
   Herramientas como **Prism** pueden validar el request contra el OpenAPI: si el body no cumple el schema, responden con 422 (o 400) y un mensaje de validación (ej. “request body must have required property 'status'”). Ese mensaje ya dice “enviaste algo que no coincide con lo que el spec dice”. Si el spec viene de CORTEX, en la práctica es “lo que el micro/servicio espera”.

3. **Mensajes más claros (“envias X, el servicio espera Y”)**  
   Los mensajes por defecto del validador (ej. Ajv/OpenAPI) suelen ser técnicos. Se puede: (A) documentar en el OpenAPI `description` de cada schema “El servicio espera: …”; (B) o en una fase futura, un middleware o proxy delante de Prism que transforme el error estándar en un texto tipo “requestBody error: enviaste X, el servicio espera Y” usando el schema del OpenAPI. Lo mínimo viable es usar Prism con validación y que el front reciba 422 + body con el detalle del error; eso ya permite ver “qué está mal”.

4. **Dinámico y por workspace**  
   Como el OpenAPI se genera desde el índice (contratos del repo), cada workspace tiene su propio spec. Mismo flujo: `cortex_refresh` → `cortex_export_openapi` → mock con validación. Si cambias el código del servicio, refrescás, reexportás y el mock valida contra el contrato nuevo.

**Resumen main gold:** El mock no solo simula respuestas; **valida** lo que envía el front (body, request) contra lo que el servicio espera (según CORTEX) y responde con **error claro** cuando hay desvío (“envias X, el micro/servicio espera Y”). Implementación: OpenAPI con schemas desde CORTEX + mock con validación (ej. Prism).

**¿Dónde se ve el error “envías X, el micro/servicio espera Y”?**  
El mock devuelve ese mensaje en la **respuesta HTTP** (status 4xx, ej. 422 Unprocessable Entity) con un **body** que incluye el detalle de validación. Quien hizo la request es quien lo ve:
- **Si quien llama es el front:** en la **pestaña Network** del dev tools del browser (response status + response body), y si la app muestra errores de API (toast, mensaje en pantalla, consola), también ahí.
- **Si probás con Postman / Insomnia / curl:** en el **body de la respuesta** del mock (JSON con el mensaje de error del validador).
- CORTEX no “muestra” el error; solo genera el OpenAPI. El **mock** (Prism, etc.) es el que responde con 4xx + body, y ese response lo recibe el cliente (front, Postman, etc.). Para que el texto sea exactamente “envías X, el servicio espera Y” se puede mejorar el OpenAPI (descriptions) o un middleware que formatee el error del validador.

**No depender de la BD:** Todo lo anterior (contratos, schemas, validación “envias X, espera Y”) sale de lo que CORTEX indexa del **código** de los microservicios y servicios: rutas, métodos, `requestBodyType`, `responseType`. Los contratos están en el código; no hace falta BD para generar el OpenAPI ni para validar. La **BD es opcional**: solo para enriquecer ejemplos con datos más reales (snapshots, fixtures, MCP de BD) si el equipo quiere. El núcleo del mock y la validación no depende de la BD.

**Alcance de este plan:** Solo esta idea. CORTEX genera artefactos (OpenAPI, ejemplos, instrucciones); el equipo ejecuta un mock local con un solo comando (o por flujo/servicio).

---

## Respuestas directas: ¿qué hace el mock? ¿y la BD?

### ¿Levanta “servicios falsos” y simula las pegadas a los servicios?

**Sí.** Lo que se levanta es un **proceso mock** (ej. Prism o WireMock) que escucha en uno o varios puertos (ej. 4010, 4011). Ese proceso **no** es el microservicio real (Nest/Spring); es un servidor HTTP que, ante cada request a la misma ruta que el servicio real (ej. `GET /v1/private/applications`), responde con lo que indica el OpenAPI generado por CORTEX (por defecto 200 y un body de ejemplo si lo definimos).  
El front o el BFF **siguen haciendo las mismas “pegadas”** (misma URL, mismo método); solo cambia la base URL (ej. `http://localhost:4010` en vez de `http://localhost:3001`). Así se **simulan** las respuestas de los microservicios/servicios sin levantar los procesos reales.

### ¿Lo que devuelve el mock es “lo que traería la BD” según el refresh de CORTEX?

**No del todo.** En el refresh CORTEX **no** indexa el contenido de la base de datos (no lee filas ni resultados de queries). Lo que indexa es:

- **Contratos** (endpoints): método, path, y si está en el código, `requestBodyType` y `responseType` (nombres de DTOs/clases).
- **db_table** (en repos con SQL): nombre de tablas, schema, operación (desde archivos .sql / migrations), **no** los datos que hay en la BD.

Por tanto, el mock **no** puede devolver “lo que actualmente trae la BD”. Lo que puede devolver es:

1. **Respuestas de ejemplo definidas en el OpenAPI** (Fase 2 del plan): generadas a partir de lo que CORTEX sí tiene —por ejemplo el nombre del tipo de respuesta (`responseType`)— con un JSON mínimo o placeholder (ej. `{}` o `{ "responseType": "ApplicationDto" }`). Eso **simula** que el servicio respondió algo coherente con el código, pero no son datos reales de BD.
2. **En el futuro** (fuera de este plan): si se indexan DTOs con propiedades, se podrían generar ejemplos más ricos; o si se graban respuestas reales (har, snapshots), usarlas como `examples` en el OpenAPI para que el mock devuelva “lo que una vez devolvió el backend” (que sí podría incluir datos que venían de BD). O, usando `db_table`, generar **fixtures** (filas de ejemplo) y levantar un DB local con esos datos y que un servicio real pequeño o un mock más inteligente lean de ahí.

**Resumen:** El mock **sí** levanta “servicios falsos” que simulan las pegadas HTTP a los servicios. Lo que devuelve es lo que **definamos en el OpenAPI** (formas y ejemplos derivados del código indexado), **no** “lo que trae la BD” en tiempo real; para acercarse a datos tipo BD haría falta grabar respuestas reales o generar fixtures a partir de esquemas (futuro).

### ¿Se puede hacer en CORTEX la parte de “datos como los de la BD”?

**Sí.** Las dos vías encajan en CORTEX así:

1. **Grabar respuestas reales (har / snapshots)**  
   - El equipo graba llamadas reales (herramienta de red del browser → export HAR; o Postman/Insomnia export; o un proxy que guarde `method + path + response body`).  
   - Esos archivos se guardan en el workspace (ej. `cortex-mocks/snapshots/` o `docs/har/`).  
   - CORTEX en el **refresh** puede indexar esa carpeta: leer cada snapshot y crear entradas de un nuevo tipo (ej. `response_snapshot`) con `method`, `path`, `status`, `body` (o path al archivo).  
   - Al **exportar OpenAPI**, CORTEX cruza contratos con snapshots: si para un endpoint existe un snapshot, usa ese `body` como `example` en el OpenAPI. Así el mock devuelve “lo que una vez devolvió el backend” (datos reales o muy parecidos a los de BD).  
   - **Implementación en CORTEX:** nuevo extractor (ej. `snapshots.ts`) que lea HAR o JSON de snapshots; nuevo `MemoryKind`: `response_snapshot`; en `buildOpenApiFromContracts` (o en la fase de ejemplos), buscar snapshot por método+path y añadir `example` al response.

2. **Fixtures desde esquemas (db_table / DTOs)**  
   - CORTEX ya indexa **db_table** (tabla, schema, operación) desde archivos SQL. Si en el futuro se indexan también **columnas** (desde DDL o migraciones), se podría tener “esta tabla tiene columnas id, name, created_at”.  
   - Con eso, CORTEX puede **generar filas de ejemplo** (fixtures): por cada tabla, un JSON con propiedades y valores placeholder (ej. `{ "id": "uuid", "name": "string", "created_at": "2024-01-01" }`) o SQL INSERT con valores de ejemplo.  
   - Esos fixtures no reemplazan al mock HTTP: el mock sigue siendo Prism/OpenAPI. Pero se pueden usar para: (A) levantar un **DB local** (Docker) con datos mínimos y que **un solo servicio** (el que necesita BD) apunte a ese DB y el resto siga mockeado; o (B) si se indexan DTOs del backend (clases que mapean a tablas), generar el `example` del OpenAPI a partir del mismo esquema (mismas propiedades que la tabla/DTO).  
   - **Implementación en CORTEX:** extender el indexador de `db_table` para extraer columnas cuando sea posible; nueva herramienta o paso en `cortex_export_openapi`: `cortex_export_fixtures(repo?)` que escriba JSON o SQL de fixtures; opcionalmente, al generar ejemplos de OpenAPI, cruzar por nombre (ej. responseType `Application` → tabla `applications` o DTO indexado) y rellenar el `example` con esa estructura.

En ambos casos CORTEX **no** ejecuta el backend ni conecta a la BD; solo **indexa** (snapshots o esquemas) y **usa** eso al generar OpenAPI o archivos de fixtures. La ejecución (mock, DB local) sigue en manos del equipo.

### Uso del MCP de base de datos (postgres-dev / qa / prod)

En el workspace hay un **MCP de conexión a bases de datos** (lectura, ej. postgres-dev-movil, postgres-qa-movil, postgres-prod-movil). Eso permite una tercera vía para “datos como los de la BD”:

- **Flujo posible:**  
  1. CORTEX indexa **db_table** (tablas, schema) y **contratos** (qué endpoints hay).  
  2. CORTEX (o una herramienta nueva) puede **sugerir queries de ejemplo** por endpoint o por tabla: ej. “Para GET /applications podés obtener datos de ejemplo con: `SELECT * FROM applications LIMIT 5`” (leyendo desde el índice qué tablas existen y qué rutas hay).  
  3. El usuario (o el asistente) ejecuta esa query **con el MCP de BD** (read-only) contra dev/qa.  
  4. El resultado (JSON o filas) se guarda como **snapshot** en el workspace (o se pasa a CORTEX) y CORTEX lo usa como `example` en el OpenAPI la próxima vez que exporte.  
  Así el mock puede devolver **datos reales** (o una copia) de la BD sin que CORTEX se conecte a la BD: el MCP de BD hace la lectura y el resultado se integra como snapshot/ejemplo.

- **Variante más integrada (orquestada por el cliente):**  
  Si el cliente (Cursor/agente) puede orquestar dos MCPs: “generar OpenAPI para ms-application con datos de ejemplo desde la BD”. Entonces: (1) CORTEX devuelve la lista de endpoints y, para cada uno, la tabla o query sugerida; (2) el cliente llama al MCP de BD con esas queries (ej. contra postgres-dev); (3) el cliente guarda los resultados (o los envía a CORTEX como contenido); (4) CORTEX genera el OpenAPI incluyendo esos resultados como `examples`. CORTEX sigue sin tener conexión directa a la BD; quien consulta es el MCP de BD, y CORTEX solo consume el resultado ya obtenido.

- **Resumen:** Tener MCP de BD permite que los “datos como los de la BD” vengan de **consultas reales (read-only)** a dev/qa, y que ese resultado se use como ejemplos del mock. CORTEX no ejecuta las queries; puede **sugerir** las queries a partir de db_table y contratos, y **consumir** los resultados una vez que el cliente los obtenga vía el MCP de BD.

---

## Qué tiene hoy CORTEX que usamos

- **Contratos indexados** (`kind: "contract"`): por cada repo Nest/Spring/Express, se indexa `method`, `fullPath`, `requestBodyType`, `responseType`, `handlerName`, `source` (repo id). Origen: `routes.ts`, `routes-spring.ts`, `extractNestRoutes`, etc.
- **Response schemas** (kind: response_schema): interfaces/tipos del front (ej. BureauCallsDashboardResponse) en src/services, src/types; se usan para generar examples en el OpenAPI.
- **Endpoint mapping**: qué repo llama a qué servicio y con qué paths (BFF → ms-application, etc.).
- **Flujos**: `get_flow(topic)` devuelve pantallas y endpoints por pantalla; se puede filtrar “endpoints del flujo X”.
- **Memoria** en disco (persistence) y `getMemory()` para leer todo el índice.

Con eso alcanza para: (1) generar OpenAPI por servicio o por flujo, (2) ejemplos de response generados automáticamente desde tipos del front (response_schema + responseType), (3) validación quirúrgica (404/422 con Prism --validate-request), (4) outputPath en cortex_export_openapi para escribir el OpenAPI en el workspace, (5) instrucciones para levantar el mock. Cadena de mocks conectados: ver PLAN-GENERACION-MOCK-DATA-AUTOMATICA.md (secciones 0 y 5.2).

---

## Soluciones a realizar (en orden)

### Fase 1: OpenAPI generado desde el índice

**Objetivo:** Una herramienta MCP que genere un archivo OpenAPI 3.0 (JSON o YAML) a partir de los contratos indexados.

1. **Nueva herramienta `cortex_export_openapi`**
   - **Parámetros:** `serviceId` (opcional, ej. `ms-application`) o `topic` (opcional, ej. `committee` para solo endpoints del flujo). Si no se pasa nada, “todos” los servicios que tengan contratos.
   - **Comportamiento:**
     - Si `serviceId`: filtrar entradas `kind === "contract"` donde `source === serviceId`. Si `topic`: usar lógica similar a `get_flow` para obtener los endpoints del flujo y luego filtrar contratos por esos paths/servicios.
     - Construir un objeto OpenAPI 3.0: `openapi`, `info`, `paths`. Por cada contrato: `paths[path][method]` con `summary`, `description` (desde `content` o título), y si existe `requestBodyType`/`responseType`, poner `requestBody`/`responses` con schemas mínimos (ej. `{ "type": "object", "description": "RequestBodyType: <nombre>" }`).
   - **Salida:** Devolver el OpenAPI como texto (JSON o YAML según parámetro `format`) para que el cliente lo guarde en un archivo (ej. `cortex-mocks/ms-application.yaml`). Opcional: parámetro `outputPath` (relativo al workspace) para que CORTEX indique “guardá este contenido en este path”.

2. **Detalle de implementación**
   - En `index.ts`: nuevo handler para `cortex_export_openapi`. Leer contratos de `getMemory()`; agrupar por `source` (servicio); para cada path, normalizar (ej. `/v1/private/...` sin duplicados).
   - Crear función `buildOpenApiFromContracts(contracts: MemoryEntry[], options: { title?, version? })` que devuelva el objeto OpenAPI. Incluir en cada operación:
     - `summary`: método + path
     - `responses`: al menos `200` con `description` y, si hay `responseType`, un `schema` mínimo.
     - Para POST/PUT/PATCH: `requestBody` con `schema` mínimo si hay `requestBodyType`.
   - No es necesario (fase 1) generar schemas complejos; basta con que Prism/WireMock puedan servir el mock y que Swagger UI muestre los endpoints.

**Entregable:** El equipo puede llamar `cortex_export_openapi(serviceId: "ms-application")` o `cortex_export_openapi(topic: "committee")`, guardar el YAML/JSON y abrirlo en Swagger UI o usarlo con Prism.

---

### Fase 2: Ejemplos de respuesta (opcional pero recomendado)

**Objetivo:** Que el OpenAPI incluya `example` o `examples` en las respuestas para que el mock devuelva un body coherente (aunque sea placeholder).

1. **Ejemplos mínimos por tipo**
   - Si `responseType` es un nombre de DTO (ej. `ApplicationDto`), no tenemos la estructura en el índice hoy. Opción A: poner un ejemplo genérico `{ "id": "string", "data": {} }` y en la descripción indicar “ResponseType: ApplicationDto”. Opción B (futuro): si en algún momento se indexan DTOs/interfaces, generar un JSON con propiedades y valores placeholder.
   - Por ahora: para cada endpoint con `responseType`, añadir en el OpenAPI `responses.200.content['application/json'].example` con un objeto mínimo, por ejemplo `{ "responseType": "<responseType>" }` o `{}` si no hay tipo.

2. **No bloqueante**
   - Fase 1 ya permite mockear (Prism responde 200 con lo que sea). Fase 2 mejora la utilidad del mock para el front. Se puede implementar después de Fase 1.

**Entregable:** OpenAPI con `example` en 200 cuando haya `responseType`, para que el mock devuelva algo predecible.

---

### Fase 3: Instrucciones para levantar el mock (script + .env)

**Objetivo:** Un solo comando (o pocos) para levantar el mock después de exportar el OpenAPI.

1. **Salida de CORTEX: texto con instrucciones**
   - Al exportar OpenAPI, CORTEX puede devolver además un bloque de texto tipo:
     - “Para mockear **ms-application** en local: guardá el OpenAPI anterior en `cortex-mocks/ms-application.yaml` y ejecutá: `npx prism mock cortex-mocks/ms-application.yaml --port 4010`.”
     - “Para usar el mock desde el front, configurá: `VITE_MS_APPLICATION_URL=http://localhost:4010` (o la variable que use tu app).”
   - Asignar un puerto sugerido por servicio (ej. 4010, 4011, 4012…) basado en una lista ordenada de `source` de los contratos. Documentar en el mismo mensaje.

2. **Script opcional en el repo**
   - CORTEX no ejecuta procesos. Opción: que CORTEX genere (o que el equipo agregue a mano) un script `scripts/start-mock.sh` o `scripts/start-mock.ps1` que:
     - Asuma que los OpenAPI ya están en `cortex-mocks/` (generados por `cortex_export_openapi`).
     - Levante Prism (o WireMock) por cada archivo en esa carpeta, cada uno en un puerto distinto.
   - La primera vez puede ser un script estático que el equipo edita con los nombres de archivo y puertos; más adelante CORTEX podría generar el script si se agrega una herramienta “generar script de mock”.

**Entregable:** Después de exportar OpenAPI, el equipo tiene el comando exacto (y opcionalmente un script) para levantar el mock y las variables de entorno para apuntar el front al mock.

---

### Fase 4: Mock “por flujo”

**Objetivo:** Poder generar un OpenAPI que solo incluye los endpoints usados en un flujo (ej. committee), para no mockear servicios enteros sino solo lo necesario para esa feature.

1. **Reutilizar `get_flow` y filtrado**
   - `cortex_export_openapi(topic: "committee")`: 
     - Llamar internamente a la lógica de flujo (o `get_flow`) para obtener los endpoints (método + path) que usa ese flujo.
     - Cruzar con contratos: quedarse con los contratos cuyo `method` + `fullPath` (normalizado) coincidan con esos endpoints. Si un endpoint es de un BFF que llama a ms-application, hay que incluir tanto el contrato del BFF como el del micro si están indexados (o solo los que el front llama, según cómo esté armado el flujo).
   - Generar un único OpenAPI que solo tenga esos paths. Si dos servicios distintos exponen paths en el flujo, se puede: (A) un solo OpenAPI con todos los paths (el mock tendría que servir ambos “servicios” en el mismo puerto, lo cual es posible con Prism si los paths no colisionan), o (B) dos OpenAPI (uno por servicio) y dos comandos Prism en dos puertos. La opción (A) simplifica “un solo proceso” para el flujo.

2. **Documentación**
   - En la respuesta de la herramienta: “OpenAPI del flujo **committee** (N endpoints). Para mockear: …” con el comando y la sugerencia de .env.

**Entregable:** El equipo puede pedir “OpenAPI del flujo committee” y levantar un solo mock con solo esos endpoints.

---

### Fase 5: Base de datos (opciones, sin implementación pesada)

**Objetivo:** Dejar documentadas las opciones para no bloquear el uso del mock por “qué hacemos con la DB”.

1. **Opción A – Algunos servicios contra nube**
   - Documentar: “Los endpoints que dependen de datos reales (ej. ms-application que usa DB) pueden seguir apuntando a staging/nube; el resto se mockea.” CORTEX podría en el futuro listar “endpoints que probablemente usan DB” (por convención o por dependency a repos con SQL) para que el equipo sepa cuáles dejar contra nube.

2. **Opción B – Fixtures (futuro)**
   - Si CORTEX indexa tablas (db_table), en el futuro se podría generar fixtures (SQL o JSON) para levantar un DB local con datos mínimos. Fuera de alcance de la primera versión del plan.

3. **Opción C – Respuestas grabadas (futuro)**
   - Si el equipo graba respuestas reales (har, Postman export), se podrían usar como `examples` en el OpenAPI. Fuera de alcance inicial.

**Entregable (fase 5):** Solo documentación en el mismo doc o en IDEAS-MCP: “Para DB: por ahora usar nube para los servicios que lo necesiten; el mock sirve el resto.” No implementar nada nuevo en código en esta fase.

---

## Orden de implementación recomendado

1. **Fase 1** – `cortex_export_openapi(serviceId?, topic?, format?)` y `buildOpenApiFromContracts`. Entregar OpenAPI por servicio o por flujo.
2. **Fase 3** – Incluir en la respuesta de la herramienta el texto con el comando Prism y la sugerencia de .env (y opcional script en el repo).
3. **Fase 4** – Asegurar que `topic` en `cortex_export_openapi` filtre por flujo y genere un OpenAPI único del flujo.
4. **Fase 2** – Añadir ejemplos mínimos en respuestas cuando haya `responseType`.
5. **Fase 5** – Dejar documentadas las opciones de DB; sin desarrollo adicional por ahora.

---

## Resumen de valor para el equipo

- **Un solo proceso (Prism)** por servicio o un solo proceso para el flujo, en lugar de N microservicios.
- **OpenAPI derivado del código** que ya indexa CORTEX; no hace falta mantener un Swagger a mano.
- **Un comando** después de guardar el OpenAPI: mock en local; el front (o un cliente) apunta al mock vía variable de entorno.
- **DB:** por ahora se deja documentado (usar nube para lo que necesite datos reales); el mock cubre el resto.

CORTEX no corre el mock; **genera los artefactos y las instrucciones**. El equipo ejecuta el comando y tiene el backend mockeado en local.
