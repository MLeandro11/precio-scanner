# Feature: precio por sucursal en el detalle del producto (`sucursales-en-detalle`)

**Status:** slice 1 (núcleo puro) **hecho, verificado y commiteado** en `45e85b2` · **slice 2 pendiente**
**Started:** 2026-10-01
**Branch:** `main` (convención del repo: se commitea sobre `main`, no se crea feature branch)
**Origen:** spike de solo lectura sobre la API de Precios Claros/SEPA, autorizado por el usuario
(2026-10-01). Llena el cartel que ya existe en `src/pages/ProductPage.tsx:152`
(*"Comparación entre almacenes… llegan cuando haya datos de más de una tienda"*).

## Goal

Que la pantalla de detalle de un producto (`/producto/:ean`) muestre, además del precio del catálogo
local, **el precio de ese mismo EAN en las sucursales informadas cerca del usuario**, ordenado de
más barato a más caro, con la distancia de cada una.

Fuente: `GET /prod/producto?id_producto=<EAN>` de la API de Precios Claros (SEPA), verificada en
vivo. Es **solo lectura sobre la API**: no cambia el catálogo local, no toca el worker, no toca el
buscador.

## Por qué esta forma y no la de la lista de compras

La idea original era rankear las sucursales por el costo de **toda la lista de compras**. Se midió y
**no se banca**:

| medición (muestra real, Río Gallegos) | resultado |
| --- | --- |
| Cobertura de los EAN del catálogo local en SEPA | **40%** (10/25 y 10/25 en dos muestras) |
| Ranking de lista | 8 sucursales empatadas, todas **+14,1%** más caras que el almacén |
| Ranking por producto (variación entre sucursales) | **9 de cada 10** productos varían de precio |

En la lista, el 40% de cobertura **rompe el ranking** (una sucursal que "cubre 3 de 12" no significa
nada). Por producto, cada pantalla es una respuesta completa o un vacío honesto.

**Decisión del usuario (2026-10-01): el precio por sucursal vive en el detalle del producto.**
Además elimina el bloqueante del IVA: todos los precios mostrados vienen de la misma fuente, así que
la comparación entre sucursales es válida sin saber si el `precio` del catálogo local es neto o
final.

## Contrato de la API (verificado en vivo, no supuesto)

```
GET https://d3e6htiiul5ek9.cloudfront.net/prod/producto
    ?id_producto=<EAN>&lat=<lat>&lng=<lng>&limit=50&offset=0      # sucursales cercanas
    ?id_producto=<EAN>&array_sucursales=15-1-454,11-2-1075        # sucursales explícitas
```

- `id_producto` **más** un selector (`lat`+`lng` **o** `array_sucursales`). Sin selector: error 1.
- `maxLimitPermitido: 50`. `limit`/`offset` paginan.
- Respuesta: `{status, total, producto:{id,nombre,marca,presentacion}, maxLimitPermitido,
  totalPagina, sucursalesConProducto, sucursales[]}`.
- Cada sucursal: `id` (sucursalId), `comercioId`, `banderaId`, `banderaDescripcion`,
  `comercioRazonSocial`, `sucursalNombre`, `sucursalTipo`, `direccion`, `localidad`, `provincia`,
  `lat`, `lng`, `distanciaNumero`, `distanciaDescripcion`, `actualizadoHoy`, y **`preciosProducto`**
  con `precioLista` (y `precio_unitario_con_iva` / `precio_unitario_sin_iva` / `precio_bulto_*` /
  `promo1` / `promo2` que vienen **vacíos**).
- **El precio está en `preciosProducto.precioLista`**, no en un campo `precio` plano.
- **Clave de sucursal = `${comercioId}-${banderaId}-${id}`** (ej. `15-1-454`): en `/prod/producto`
  los tres vienen sueltos; en `/prod/sucursales` el `id` ya viene compuesto así.
- Unidades: **pesos**, igual que el catálogo local. No convertir.
- `total` = conteo **nacional** de sucursales con el producto, independiente de `limit`.
- `totalPagina` es el **`limit` pedido**, no la cantidad de páginas (páginas = `ceil(total/limit)`).

### Trampas verificadas

1. **HTTP 200 con error adentro**: el status real está en el campo `status` del body.
2. EAN inexistente → **HTTP 200** con `producto:{msg:"Producto inexistente."}`, `total:0`,
   `sucursales:[]`. Es un estado normal, **no un error**.
3. Sucursal sin el producto → entra en `sucursales[]` con `message:"La sucursal no contiene el
   producto."` y sin `preciosProducto.precioLista`. No es un error.
4. `promo1`/`promo2` existen pero se midieron **vacías** en 50 sucursales → no prometerlas.
5. El WAF bloquea User-Agents desconocidos con un 403 HTML que **nunca llega a la API** (10/10 UAs
   aleatorios bloqueados; `Mozilla/5.0` pasó 15/15). Aplica a scripts de prueba, no al navegador.
6. Nunca mandar el parámetro `entorno`: con cualquier valor devuelve `total: 0`.
7. **La distancia puede ser enorme y el producto igual "existe"**: medido con coordenadas de Río
   Gallegos, la Coca Cola 1.5L devuelve como sucursal más cercana una **a 644 km** (Rada Tilly). El
   `cantSucursalesDisponible` del buscador **no significa cercanía**: cuenta sucursales de la lista,
   que pueden estar a 700 km. Por eso la distancia se muestra siempre y la cercanía nunca se asume.

## Los tres estados que la UI debe distinguir

| estado | condición en la respuesta | copy |
| --- | --- | --- |
| `con-precios` | hay ≥1 sucursal con `precioLista` numérico | la tabla, ordenada por precio |
| `sin-precio` | hay sucursales pero ninguna con `precioLista` | *"No hay precio informado para este producto."* |
| `sin-datos` | `total === 0` o `producto.msg` presente | *"Nadie informa este código."* |

Caso frecuente y **no** un error: `con-precios` donde la sucursal más barata está a 182 km. La
distancia se muestra siempre; la cercanía es información, no un filtro.

## Decisions taken by the orchestrator (reversible; correctable by the user)

1. **No se construye el optimizador de cesta** ni la pantalla de ranking de sucursales: medido, no
   se banca (todas las opciones más caras que el almacén; coberturas de 3/12).
2. **Se posterga** el selector de localidades de todo el país y `scripts/generate-localidades.ts`:
   eran para la pantalla de sucursales, que ya no existe. Se retoman si hacen falta.
3. **No se persiste la ubicación del usuario**: las coordenadas viajan por request (la API las pide
   igual) y no se guardan. El ancla persistida (si llega a hacer falta) es la sucursal elegida.
4. **Sin loops de retry**: convención del repo (`searchSession.ts`). Un fallo de red deja la pantalla
   como está hoy, con el precio local.
5. **La comparación "vs tu precio" queda fuera de este slice**: depende de si el `precio` del
   catálogo local es neto o final (IVA). La tabla de sucursales no depende de eso.
6. **`total > 0` con `sucursales[]` vacío** (paginación agotada) se trata como `sin-datos`.
7. **Un `precioLista: 0` finito y real se acepta**: el criterio 5 prohíbe *fabricar* un 0, no
   descartar un 0 que la API realmente informó.
8. **Empates completos** (mismo precio y misma distancia) conservan el orden de origen de la API:
   sin criterio, un orden inventado sería peor que el que ya viene.

## Allowed edit surfaces

```
src/lib/preciosClaros/**          (nuevo)
src/lib/preciosClaros/fixtures/** (nuevo: respuestas reales grabadas)
```

Nada más. **Este slice no toca la UI**: ni `ProductPage.tsx`, ni `App.tsx`, ni el worker, ni
`catalogLoader`, ni el catálogo local. La integración visual es el slice siguiente.

## Tasks

- [ ] **T1** — `src/lib/preciosClaros/client.ts`: fetch tipado e inyectable. Arma la query
      (`id_producto` + `lat`/`lng` o `array_sucursales`, `limit`, `offset`), timeout con
      `AbortSignal.timeout`, **sin retry**, y traduce `status !== 200` del body a un error tipado.
      Nunca devuelve datos si `status !== 200`.
- [ ] **T2** — `src/lib/preciosClaros/schema.ts`: tipos de la respuesta + validación defensiva
      (`precioLista` solo se acepta si es número finito; `message` y `producto.msg` contemplados).
- [ ] **T3** — `src/lib/preciosClaros/map.ts`: DTO → `SucursalPrecio[]`. Compone la clave
      `comercioId-banderaId-id`, descarta sucursales sin precio, ordena por precio ascendente y
      calcula `deltaVsMasBarato`. Función **pura**, sin red ni React.
- [ ] **T4** — `src/lib/preciosClaros/estado.ts`: deriva los tres estados de la sección anterior.
      Puro y testeable.
- [ ] **T5** — Tests colocados (`*.test.ts`, vitest en Node) con las fixtures reales de
      `fixtures/`: orden por precio y no por distancia, clave compuesta, los tres estados, `0`/`NaN`
      nunca aceptados como precio, `status !== 200` con HTTP 200 → error, y la fixture mixta de
      `array_sucursales` (una sucursal con precio + una con `message`).
- [ ] **T6** — Verificación: `npm run typecheck` y `npm test` en verde, sin regresiones.

## Criterios de aceptación (testeables)

1. Con la fixture de sucursales de Río Gallegos, la **más barata va primera**.
2. El orden es **por precio, no por distancia**: en `lat-lng-lejos-644km.json` la más cercana
   (644 km, $4.390) **no** es la más barata ($3.950 a 1.293 km), y el test afirma el orden por precio.
3. `producto.msg: "Producto inexistente."` → estado `sin-datos`. Ni error, ni `$0`, ni `NaN`.
4. Sucursales presentes pero sin `precioLista` numérico → estado `sin-precio` (copy propio).
5. `precioLista` ausente, `""`, `null` o `NaN` → **nunca** se convierte en `0` ni se muestra.
6. `status: 400` en el body con HTTP 200 → error tipado; el llamador no recibe datos.
7. Caída de red / timeout → error tipado, y la pantalla puede seguir mostrando el precio local.
8. La clave de sucursal es `comercioId-banderaId-id` (test explícito con `comercioId: 15`,
   `banderaId: 1`, `id: "454"` → `15-1-454`).
9. `total` no se usa como cantidad de sucursales mostradas (es el conteo nacional).
10. **Caso "todas iguales"**: en `lat-lng-rio-gallegos.json` las 10 sucursales de La Anónima en Río
    Gallegos tienen el **mismo** precio ($4.950). El núcleo **no expone ningún delta** (decisión
    "sin delta", ver abajo), así que no hay ahorro que inventar; la tabla sigue siendo útil por la
    distancia.

## Verificación

**Verificada.** Corrida por el writer y **repetida de forma independiente por `gentle-ai-verify`**
(read-only, sin tocar el repo):

- `npm run typecheck` — limpio (exit 0, sin salida).
- `npx vitest run` — **24 archivos / 270 tests / 0 fallos**. Módulo nuevo: 4 archivos / 39 tests.
- **Baseline reproducido, no inferido**: `npx vitest run $(git ls-files '*.test.ts')` → **20 archivos
  / 231 tests / 0 fallos**. `git diff` y `git diff --cached` vacíos: ningún archivo trackeado fue
  modificado, debilitado ni borrado. 231 + 39 = 270.
- **10/10 criterios PASS**, con dos matices registrados: AC10 se cumple **acotado a las 10 sucursales
  de Río Gallegos** (globalmente el mínimo es otro, ver abajo), y el test nombrado de AC1 es
  auto-referencial, así que su evidencia real es otro test + extracción independiente del fixture.
- Adversarial sobre `client.ts`: el único `return` de datos ocurre con `status === 200`; sin retry,
  sin backoff, sin fallback silencioso; `entorno` nunca se manda; el timeout es un `AbortSignal` real.
- Adversarial sobre `schema.ts`/`map.ts`: refutado que `""`/`null`/`undefined`/`NaN`/`Infinity`
  puedan convertirse en `0`; el sort compara precio antes que distancia.
- Los tests **leen los fixtures** (`readFileSync` sobre el archivo, sin copias inline) y usan
  literales duros que la verificación re-extrajo por su cuenta del fixture → si un fixture cambia,
  los tests se ponen rojos. Un test que no puede fallar no es evidencia.
- **Sin regresiones y sin commits.**

No verificable y por lo tanto abierto: autenticidad byte a byte de las fixtures (no hay captura de
referencia) y comportamiento de red real (WAF, timeout real) — solo se ejercitó el `fetch`
injectable.

**Decisión "sin delta" aplicada en el núcleo (2026-10-01), después de la verificación**: se eliminó
el campo `deltaVsMasBarato` de `SucursalPrecio` — no solo se ocultó en la UI. Re-corrida tras el
cambio: **24 archivos / 270 tests / 0 fallos**, `npm run typecheck` limpio, y un test afirma
(`Object.keys(...).not.toContain('deltaVsMasBarato')`) que el campo ya no existe. La verificación
independiente anterior sigue válida para todo lo demás: el cambio solo resta un campo derivado.

## Fixtures (respuestas reales, grabadas)

El **contenido** es verbatim (sin recortes ni edición de datos). Precisión que faltaba: los dos
archivos chicos (`array-sucursales-mixto.json`, `ean-inexistente.json`) quedaron **re-serializados
con indentación** por el script de captura, así que no son byte a byte el cuerpo HTTP; los dos
grandes son el cuerpo crudo tal cual lo devolvió `curl`. La verificación independiente detectó esta
inconsistencia de formato y la reportó como "verbatim no verificable a nivel de bytes".

| archivo | qué es |
| --- | --- |
| `lat-lng-lejos-644km.json` | EAN 7790895000430 (Coca Cola 1.5L), `lat`/`lng` de Río Gallegos, **50 sucursales**: el producto **no se vende en la ciudad**, la más cercana está a **644,83 km**. Seis precios distintos (3.950 / 4.190 / 4.390 / 4.560 / 4.590 / 4.600) y la **más barata a 1.293 km**. Fixture del criterio 2. |
| `lat-lng-rio-gallegos.json` | EAN 7790070621856 (Ravioles La Salteña), `lat`/`lng` de Río Gallegos, **50 sucursales**: **10 en Río Gallegos** (La Anónima, de 0,62 a 5,35 km) y el resto en otras ciudades hasta 975 km. Las 10 de la ciudad tienen **todas el mismo precio $4.950**. Fixture de los criterios 1 y 10. |
| `array-sucursales-mixto.json` | EAN 7790895000430 con 3 sucursales explícitas: **2 con precio** ($3.933) y **1 con** `message: "La sucursal no contiene el producto."`. Fixture del modo `array_sucursales`. |
| `ean-inexistente.json` | EAN 0000000000000: `producto.msg`, `total: 0`, `sucursales: []`. Fixture del criterio 3. |

## Decisión tomada: sin delta (2026-10-01)

El usuario eligió **(a) sin delta**. El motivo, medido: `precio - min(precio)` sobre la página
mezcla "más barato" con "cerca tuyo" — en la fixture de Río Gallegos las 10 sucursales de la ciudad
quedaban con un delta de **$250 contra una sucursal a 260,82 km** (Río Grande).

**Se aplicó en el núcleo, no solo en la UI**: el campo `deltaVsMasBarato` se **eliminó** de
`SucursalPrecio`. Dejarlo sin usar habría sido una trampa para el próximo que lo renderice, y su
nombre (`deltaVsMasBarato`) no dice que es global. Un test afirma que la clave ya no existe.

Si algún día hace falta un número de ahorro, se recalcula **re-anclado a un radio o a una ciudad** y
se nombra por esa semántica (`deltaVsMasBaratoDeLaCiudad` o similar). No se reusa este.

## Próximo slice (2): montar la sección en `/producto/:ean`

El núcleo ya está listo para consumirse: `createPreciosClarosClient`, `mapSucursales`,
`deriveEstado`. Lo que falta es la pantalla. Alcance acordado:

1. Un CTA **"Ver precios cerca mío"** en la tarjeta de precio de `src/pages/ProductPage.tsx`.
2. La ubicación se pide **al toque**, no al cargar, y el texto dice para qué se usa y que **no se
guarda** (la app nunca persiste lat/lng; el `fetch` las manda y se descartan).
3. La tabla: sucursal, distancia y precio, **ordenada por precio**. **Sin delta.**
4. Sin red, sin ubicación o sin datos: la pantalla queda como está hoy. Nada se rompe ni se
reemplaza el precio local.
5. Los tres estados del núcleo tienen que ser visibles y distintos en la UI: `con-precios`,
`sin-precio`, `sin-datos`. El último es el más frecuente (~40% del catálogo) y debe verse como un
estado normal, no como un error.

**Decisión de alcance de v1**: si el usuario niega la ubicación, una línea honesta ("activá la
ubicación para ver precios por sucursal") y nada más. El **selector de localidades de todo el país
va en su propio slice**: necesita `scripts/generate-localidades.ts` + `public/data/localidades.json`
(83 llamadas al API, tope real de 30 por página) y normalización de los nombres, que vienen sucios
(`9 De Julio` / `9 de julio`, `ACASSUSO` / `Acassuso`).

**Allowed edit surfaces del slice 2**: `src/pages/ProductPage.tsx`, `src/hooks/useUbicacion.ts`
(nuevo), `src/components/***` (componente nuevo de la tabla). Nada más: no tocar el worker, el
`catalogLoader` ni el catálogo local.

**Riesgo abierto heredado del spike**: si el resultado de la comparación es siempre "el almacén
está mejor", la feature pierde sentido. Medido en Río Gallegos: el almacén ganaba 8 de 10 ítems y
la canasta completa salía +33,9% en La Anónima. La decisión sobre si la feature se banca es del
usuario y sigue pendiente.

## Notas de ejecución

- Los spikes que originaron esto corrieron con datos reales y están en memoria Engram
  (`lupa/precios-claros-integracion`, `lupa/spike-precios-cobertura`, `lupa/geografia-rio-gallegos`).
- **Incidente de las fixtures (2026-10-01):** la primera grabación quedó truncada a 3 y 5 sucursales
  por un recorte de mi script de captura, así que el doc describía datos que los archivos no
  tenían. **Lo detectó el writer** (`gentle-ai-worker`), se negó a acomodar el doc y lo reportó; las
  fixtures se re-grabaron verbatim. Lección: una fixture truncada convierte un criterio de
  aceptación en un test que no prueba nada.
- Riesgo abierto, **fuera de este slice**: si el resultado de la comparación es siempre "el almacén
  está mejor", la feature pierde sentido y hay que decidirlo con el usuario.
