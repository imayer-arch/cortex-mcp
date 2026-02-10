# Plan: Generación automática de datos mock y validación quirúrgica (solo local)

**Objetivo:** (1) Que CORTEX genere **datos mockeados** (examples) desde el código del workspace para que **se muestren correctamente en la app** al levantar front + mocks, sin enriquecer a mano el OpenAPI. (2) Que el mock permita una **validación quirúrgica**: ver si los endpoints creados matchean cuando el front hace GET; cuando hace POST, ver si los contratos son distintos o si hay error porque se manda mal el body, etc. (3) **Objetivo explícito de cadena:** Levantar mock BFF + mocks de todos los micros y **conectarlos** para que las llamadas del front pasen por la cadena y cualquier fallo de contrato lo devuelva el mock del servicio correspondiente (404/422 con detalle). Todo solo en local; no se sube nada.

**Contexto:** Hoy el OpenAPI generado por CORTEX tiene schemas mínimos y ejemplos placeholder; el front necesita la forma real (ej. `BureauCallsDashboardResponse`). Además, con Prism en modo validación el mock ya puede devolver 404 si el path no existe, 422 con detalle si el body no cumple el contrato, etc. Este plan une **generación automática de examples** y el uso explícito de esa **validación quirúrgica** para que el flujo sea: datos que se ven en la app + feedback claro cuando algo no matchea.

---

## 0. ¿Qué “match” valida este plan? (Front ↔ Servicio ↔ Micros)

**Objetivo explícito (cadena de mocks conectados):**  
Levantar mock BFF + mocks de todos los micros y **conectarlos** para que las llamadas del front pasen por la cadena y cualquier fallo de contrato lo devuelva el mock del servicio correspondiente (404/422 con detalle).

- **Lo que el plan cubre hoy (completo para la capa que ve el front):**  
  **Front ↔ Servicio (BFF).** El mock es el contrato del BFF. Prism valida que lo que envía el front (path, query, body) cumpla ese contrato y responde con 200 + example o 404/422. Así validás que el **front y el servicio al que llama (BFF) matchean**.

- **Match “todo completo” (Front ↔ BFF ↔ Micros) — cadena conectada:**  
  Para que las llamadas del front pasen por la cadena y el fallo lo devuelva el mock del servicio que corresponda:
  - **Opción A — BFF real + mocks de micros:** Exportar OpenAPI por cada micro y levantar **un Prism por micro** (4011, 4012, …). Levantar el **BFF real** con URLs apuntando a esos mocks (ej. `MS_APPLICATION_URL=http://localhost:4013`). Front → BFF real → mocks de micros. Si el BFF manda algo que no cumple el contrato de un micro, **ese micro mock** devuelve 422 y el motivo.
  - **Opción B — Proxy “mock BFF” + mocks de micros:** Un proxy que expone la API del BFF (validando con el OpenAPI del BFF) y reenvía cada request al micro mock que corresponda (mapeo BFF→micro que tiene CORTEX). Front → proxy (mock BFF) → mocks de micros. Todo son mocks; si el proxy manda algo mal a un micro, **ese micro mock** devuelve el fail y el porqué.
  - **Solo mock BFF (sin cadena):** Front → mock BFF (Prism 4010). El mock BFF no llama a nadie; solo responde con examples. Aquí **solo** se valida front ↔ contrato del BFF.

**Resumen:** El plan deja listo el **match front ↔ BFF** y documenta cómo **levantar todos los mocks y conectarlos** (A o B) para que cualquier fallo de contrato en la cadena lo devuelva el mock del servicio correspondiente.

---

## 1. Alcance y restricciones

- **Agnóstico al workspace:** El comportamiento es independiente del workspace: los mismos flujos sirven para cualquier conjunto de repos indexados (otro front, otros BFF/micros). No se sube código ni datos sensibles; todo permanece local.
- **Solo local:** Los datos generados y los specs solo existen en el workspace (p. ej. `cortex-mocks/`). CORTEX no envía nada a la nube.
- **Datos en la app:** Los examples generados por CORTEX tendrán la **forma** que el front espera (tipos indexados del front), de modo que al hacer GET/POST contra Prism la app **muestre** esos datos (números, listas, textos) en lugar de "—" o errores de parsing.
- **Validación quirúrgica:** El mock (Prism con `--validate-request`) valida cada request contra el OpenAPI. Así se puede ver de forma **quirúrgica**: path que no matchea → 404; body que no cumple el contrato → 422 con mensaje; query params incorrectos → 422; contrato alineado → 200 y body con la forma esperada.
- **Fuente de la forma:** Tipos/interfaces del front (ej. `BureauCallsDashboardResponse`) para generar examples; contratos del backend (path, method, requestBody/response) para que Prism valide. Datos sintéticos (placeholders), no BD ni APIs reales.

---

## 2. Resultado esperado: datos en la app + validación quirúrgica

### 2.1 Los datos mockeados se muestran en la app

- Tras **cortex_refresh** y **cortex_export_openapi** (con generación automática de examples desde tipos del front), el OpenAPI incluye `example` (y opcionalmente `examples`) con la **forma correcta** (mismas propiedades que espera el front).
- Al levantar Prism con ese spec y el front con proxy al mock:
  - Las pantallas que consumen esos endpoints (ej. Llamadas a Nosis, login, listados) **reciben JSON con la estructura esperada** y la app **muestra** los datos (números, etiquetas, etc.) en lugar de "—" o errores.
- No hace falta editar a mano el JSON en cortex-mocks para tener datos útiles; CORTEX los genera a partir del código.

### 2.2 Validación quirúrgica: ver si los endpoints matchean y si el body/contrato está bien

El mock (Prism con validación) hace que cada llamada del front sea **diagnosticable** de forma precisa:

| Caso | Qué hace el front | Qué hace el mock | Cómo se ve (quirúrgico) |
|------|-------------------|------------------|--------------------------|
| **GET – path correcto** | GET `/v1/private/dashboard/bureau-calls?bureauCode=NOSIS&from=...&to=...` | Path y query están en el spec → 200 + example | La app muestra los datos (ej. total 142, 121). |
| **GET – path que no existe** | GET `/v1/private/otro-path` | No hay operación para ese path → **404** | En Network: 404. Sabés que el endpoint no está en el spec o el front está llamando mal. |
| **GET – query params faltantes o mal nombrados** | GET `/v1/private/dashboard/bureau-calls` sin `bureauCode`/`from`/`to` (si el spec los marca required) | Validación → **422** (o 400) con detalle en el body | En Network: 422 + body con mensaje tipo "must have required property 'bureauCode'". Sabés que el contrato espera esos params. |
| **POST – body correcto** | POST con body que cumple el schema del spec | Validación OK → 200 + example | La app sigue el flujo con éxito. |
| **POST – body incorrecto** | POST con body que no cumple (campo faltante, tipo mal, nombre distinto) | Validación → **422** con detalle en el body | En Network: 422 + body con mensaje tipo "request body must have required property 'X'" o "must be number". Sabés **exactamente** qué está mal (contrato distinto o front manda mal). |
| **POST – path distinto al del spec** | POST a una ruta que no existe en el OpenAPI | **404** | Sabés que ese endpoint no está en el contrato o la URL está mal. |

Así se vuelve **quirúrgico**: en DevTools → Network ves si el problema es path (404), body (422 + detalle), o query (422). No hace falta levantar el backend real para saber si “los endpoints matchean” o “si los contratos son diferentes” o “si se manda mal el body”.

Para que esto funcione bien:

- El **OpenAPI exportado** debe incluir **schemas** (aunque sean mínimos) para `requestBody` en POST/PUT/PATCH y, cuando aplique, **parameters** para GET (query, path). CORTEX ya puede incluir requestBody por `requestBodyType`; conviene añadir/mejorar query params cuando el backend los define.
- **Prism** debe levantarse con **validación de request** (ej. `--validate-request`) para que rechace y devuelva 422 cuando el body o los params no cumplan el spec.

---

## 3. Enfoque técnico

### 3.1 Indexar la “forma” de las respuestas (y opcionalmente request)

- **Nuevo tipo de entrada en memoria:** p. ej. `response_schema` (o `front_type`).
  - **Origen:** archivos TypeScript/TSX en repos “front” (p. ej. donde ya se indexan `front_route`, `front_endpoint_usage`) o en `src/services`, `src/types`.
  - **Contenido indexado:** para cada `export interface X { ... }` (y opcionalmente `export type X = { ... }`) extraer:
    - `typeName`: nombre del tipo.
    - `properties`: lista de `{ name, type }` donde `type` es el tipo TS en texto (`string`, `number`, `boolean`, objeto inline, o nombre de otro tipo indexado).
  - **Meta sugerida:** `{ typeName, properties: [{ name, type }], sourcePath }`.

- **Matching contrato → schema:**  
  - Por `responseType` del contrato (backend): buscar `response_schema` con ese `typeName` o nombre normalizado.  
  - Si no hay, por path/front usage: asociar endpoint con el tipo que usa el servicio del front (ej. retorno de `getBureauCallsStats` → `BureauCallsDashboardResponse`).  
  Si hay match, usar ese schema para generar el `example`; si no, mantener el example mínimo actual.

### 3.2 Generar el example a partir del schema

- **Función:** `generateExampleFromSchema(schema, allSchemas, depth): object`.
  - Por cada propiedad: `number` → 42, `string` → "string" (o fechas para `from`/`to`), `boolean` → true, objeto anidado → recursión con límite de profundidad (ej. 2).
  - Objetivo: que el JSON generado tenga **la misma forma** que espera el front, para que **se muestre en la app** sin errores.

- **Opcional:** Varios `examples` por endpoint (ej. mes anterior / último mes) con valores distintos; al menos un example con forma correcta mejora la UX.

### 3.3 Validación quirúrgica (Prism + OpenAPI)

- **GET:** Incluir en el OpenAPI los **parameters** (query, path) que el backend espera, con `required` y `schema` cuando se sepa. Así Prism puede validar y devolver 422 si faltan o son inválidos.
- **POST/PUT/PATCH:** Mantener (o ampliar) **requestBody** con **schema** (aunque sea mínimo: tipo, propiedades requeridas). Prism validará el body; si no cumple, 422 con detalle.
- **Responses:** Incluir al menos 200 (con example generado) y 422 (descripción de validación). No es obligatorio validar la response del mock; lo importante es que el **request** se valide para que el feedback sea quirúrgico.
- **Documentación en el spec:** En `description` de schemas/operaciones se puede indicar “El servicio espera: …” para que, cuando haya 422, el mensaje sea más claro (“envías X, el servicio espera Y”).

---

## 4. Cambios necesarios en el MCP CORTEX

### 4.1 Memoria y tipos

| Archivo | Cambio |
|---------|--------|
| `src/memory/types.ts` | Añadir `MemoryKind`: `"response_schema"`. |
| `src/memory/store.ts` | Opcional: `findResponseSchema(typeName): MemoryEntry \| undefined` para matching por nombre (exacto y normalizado). |

### 4.2 Indexador

| Archivo | Cambio |
|---------|--------|
| `src/code/indexer.ts` | En el flujo de repos tipo “front”, invocar el **nuevo extractor** de interfaces/tipos y añadir entradas `response_schema`. |
| **Nuevo:** `src/code/front-types.ts` (o `response-schemas.ts`) | Extraer de TS/TSX: `export interface X { ... }` y `export type X = { ... }` → `{ typeName, properties: [{ name, type }] }`. Acotar a `src/services`, `src/types` o archivos que importen desde ellos. |

### 4.3 OpenAPI y exportación

| Archivo | Cambio |
|---------|--------|
| `src/openapi.ts` | - `generateExampleFromSchema(schema, allSchemas, depth): object` con placeholders por tipo y profundidad limitada.  
- `buildOpenApiFromContracts(..., responseSchemas?)`: para cada contrato, resolver tipo de respuesta; si hay schema indexado, generar `example` (y opcionalmente `examples`) con la forma correcta para que **se muestre en la app**.  
- Inferir **query parameters** cuando el path tenga segmentos `:param` o cuando el backend los defina, para que la **validación quirúrgica** de GET sea posible (422 si faltan params).  
- Mantener/mejorar **requestBody** con schema para POST/PUT/PATCH para que Prism pueda devolver 422 con detalle cuando el body no matchee. |
| `src/index.ts` (handler `cortex_export_openapi`) | - Construir `Map<typeName, schema>` desde entradas `response_schema` y pasarlo a `buildOpenApiFromContracts`.  
- **Parámetro opcional** `outputPath`: si se indica, escribir el OpenAPI generado en ese path (solo dentro del workspace). Así el spec listo para Prism queda en local (ej. `cortex-mocks/bff-moor.json`). |

### 4.4 Persistencia y seguridad

- Persistencia: mismas entradas en `.cortex-cache/index.json`; no hay upload.
- `outputPath`: solo rutas dentro de `WORKSPACE_ROOT`; rechazar `..` o paths fuera del workspace.

---

## 5. Flujo de uso esperado

### 5.1 Flujo base (solo mock BFF)

1. **cortex_refresh** → CORTEX indexa contratos y, con el nuevo extractor, interfaces del front (`response_schema`).
2. **cortex_export_openapi(serviceId, outputPath: "cortex-mocks/bff-moor.json")** → Se genera el OpenAPI con examples enriquecidos (forma que espera el front) y, cuando aplique, query/requestBody con schema para validación. Se escribe el archivo en local.
3. Se levanta **Prism** con ese archivo y **validación de request** (ej. `npx prism mock bff-moor.json -p 4010 --validate-request`).
4. Se levanta el **front** con proxy al puerto del mock.
5. **En la app:** Las pantallas que consumen esos endpoints **muestran los datos mockeados** (números, textos, etc.) porque el example tiene la forma correcta.
6. **Validación quirúrgica:** Si el front hace GET a un path que no está en el spec → 404. Si hace POST con body que no cumple el contrato → 422 con detalle en el body (DevTools → Network). Así se ve si los endpoints matchean y si el body/contrato está bien o mal.

### 5.2 Flujo cadena conectada (mock BFF + mocks de todos los micros)

1. **Exportar OpenAPI por servicio:** `cortex_export_openapi(serviceId: "bff-moor", outputPath: "cortex-mocks/bff-moor.json")` y por cada micro (ej. `ms-application`, `ms-origination`, …) a `cortex-mocks/ms-application.json`, etc.
2. **Levantar todos los mocks:** Un Prism por archivo (BFF en 4010, ms-application en 4011, ms-origination en 4012, …), todos con `--validate-request`.
3. **Conectar la cadena** (una de dos):
   - **A)** Levantar el **BFF real** con variables de entorno apuntando a los mocks (ej. `MS_APPLICATION_URL=http://localhost:4011`). El front apunta al BFF real (o a un proxy que enrute al BFF real). Las llamadas del front pasan: front → BFF real → mocks de micros. Cualquier fallo de contrato (BFF→micro) lo devuelve el mock del micro.
   - **B)** Levantar un **proxy “mock BFF”** que valide contra el OpenAPI del BFF y reenvíe a cada micro mock según el mapeo BFF→micro. El front apunta a ese proxy. Las llamadas pasan: front → proxy → mocks de micros. Cualquier fallo lo devuelve el mock del servicio correspondiente.
4. **Probar en el front:** Al pegarle a endpoints, si hay un cambio local que rompe el contrato en cualquier eslabón (front→BFF o BFF→micro), el mock correspondiente devuelve el fail (404/422) y el motivo.

---

## 6. Resumen de tareas (checklist)

**Generación de datos y validación front ↔ BFF**

- [ ] **Memoria:** Añadir `MemoryKind`: `"response_schema"`.
- [ ] **Extractor:** Nuevo módulo que parsee interfaces/tipos en TS/TSX del front y emita entradas `response_schema` con `typeName` y `properties`.
- [ ] **Indexador:** Integrar el extractor en repos tipo front; persistir en caché.
- [ ] **OpenAPI:** `generateExampleFromSchema(schema, allSchemas, depth)` con placeholders por tipo y profundidad limitada.
- [ ] **OpenAPI:** En `buildOpenApiFromContracts`, resolver responseType/path a schema indexado; si hay match, generar `example`/`examples` para que **los datos se muestren en la app**.
- [ ] **OpenAPI:** Añadir/mejorar **query parameters** y **requestBody** con schema en el spec para que Prism pueda hacer **validación quirúrgica** (404/422 con detalle).
- [ ] **Export:** Parámetro opcional `outputPath` en `cortex_export_openapi`; escribir el OpenAPI en ese path (solo dentro del workspace).
- [ ] **Docs:** Actualizar README/PLAN-MOCK-BACKEND-LOCAL: generación automática de examples (datos en la app) + validación quirúrgica (GET/POST, 404/422).

**Cadena de mocks conectados (mock BFF + mocks de todos los micros)**

- [ ] **Docs:** Pasos para exportar OpenAPI por cada servicio (BFF + cada micro) y levantar todos los Prism con `--validate-request`.
- [ ] **Docs:** Pasos para conectar: (A) BFF real con URLs a los mocks de micros, o (B) proxy “mock BFF” que reenvíe al micro mock correspondiente (usando mapeo BFF→micro).
- [ ] **Opcional — script o doc:** Comando o script para levantar todos los mocks de una vez (puertos 4010, 4011, …) desde los JSON en `cortex-mocks/`.

Con esto, CORTEX genera datos mockeados que **se muestran en la app**, el mock permite validación **quirúrgica** front ↔ BFF (404, 422 con detalle), y el plan deja documentado cómo **levantar todos los mocks y conectarlos** para que cualquier fallo de contrato en la cadena lo devuelva el mock del servicio correspondiente. Todo en local.
