# Feature: actualización diaria del catálogo desde kioskos.app (`catalog-refresh`)

**Status:** Etapa 1 (T1-T4) **hecha y commiteada** en `dc93f8c` · Etapa 2: T5 **hecha, verificada y
commiteada** en `ddb780d` · **Started:** 2026-10-02
**Branch:** `main` (convención del repo: se commitea sobre `main`, no se crea feature branch)
**Origen:** pedido del usuario, 2026-10-02: *"tenemos que empezar a ver cómo hacer para actualizar
el catálogo"* → *"el catálogo sale de un scrapeo, tendríamos que ver cómo hacer para que se
implemente solo cada día o cada cierto tiempo"*.

El diseño no es especulativo: sale de un reconocimiento **de solo lectura** del sitio real
(`https://kioskos.app/app`) y de la lectura de su propio bundle. No se usaron credenciales del
usuario en ningún momento. Evidencia completa en Engram: `precio-scanner/kioskos-api`,
`precio-scanner/kioskos-token-lifetime`, `precio-scanner/catalogo-update-pipeline`,
`precio-scanner/catalogo-extraction-snippet`.

## Goal

Que `public/data/*` en producción se actualice **solo, una vez por día**, desde kioskos.app, sin
depender de que la máquina del usuario esté encendida y sin que el catálogo sin normalizar —que
trae costo y margen— salga nunca de un runner efímero.

## Hallazgos que fijan el diseño (verificados, no supuestos)

1. **No es un scrapeo de DOM.** La app es una SPA de Vite contra una API REST propia en el mismo
   origen (`/api`) con `Authorization: Bearer <token>`. El catálogo se lee así:

   | Endpoint | Rol |
   | --- | --- |
   | `POST /api/entrar` `{email, clave}` | login propio → `{token, empleado, negocio, negocios}` |
   | `GET /api/productos-cuantos` | `{cuantos, conGondola, conAlgo}` — **el oráculo** |
   | `GET /api/productos?tope=500&desde=N` | `{productos: [...]}` — el catálogo, paginado |
   | `POST /api/cambiar-negocio` `{negocioId}` | devuelve **token nuevo** ⇒ el token está atado al local |

   Lo que ve el usuario como "carteles de precio" es la única pantalla que recorre el catálogo
   entero: su cliente pagina de a 500 hasta que una página vuelve incompleta. El array de >20.000
   items que el snippet de consola del usuario encuentra en el estado de un componente React **es
   esa paginación acumulada**.

2. **El token vive 12 horas exactas** (`iat 2026-10-02 04:00:15 UTC` → `exp 16:00:15 UTC`). No hay
   refresh token en el cliente: ante un 401 la app simplemente desloguea. ⇒ **cada corrida necesita
   un login fresco** y la credencial tiene que estar disponible para el job. Se cae el diseño
   "guardar solo el token, nunca la contraseña".

3. **El catálogo sin normalizar es información comercial del usuario**: `raw-catalog.json` trae
   `costo`, `costoEstimado`, `margen`, `proveedorId`, `stockMinimo`. `normalize` los descarta y
   `public/data/catalogo.json` queda con `id, nombre, marca, categoria, barcode, precio` — lo mismo
   que el sitio ya publica en cada cartel.

4. **El repo `MLeandro11/precio-scanner` es público.** Los logs de Actions y los artifacts también.
   ⇒ la regla de higiene de abajo no es una preferencia.

## Authorized decisions (user, 2026-10-02)

- **D1 — El job corre en GitHub Actions**, no en la máquina del usuario: *"me conviene más la D,
  porque no puede tener la máquina siempre encendida"*.
- **D2 — Los datos se publican en un branch `datos`**, no commiteados en `main`: *"vamos con branch"*.
- **D3 — La credencial es la cuenta propia del usuario**, no un usuario empleado dedicado: *"el
  usuario es mío"*. Consecuencia aceptada: el secreto de GitHub es la cuenta de dueño.

## Orchestrator decisions (reversibles; el usuario puede corregirlas)

- **D4 — `refresh` orquesta por subproceso, no por refactor.** `scripts/refresh-catalog.ts` invoca
  `normalize-catalog.ts` y `generate-index.ts` con `node <script>` en vez de importar sus funciones.
  Motivo: los dos ya son CLIs fail-loud con salida propia y tests; refactorizarlos para ganar una
  llamada a función agrega riesgo sobre código verificado sin cambiar el resultado.
- **D5 — Toda la lógica de comparación es pura y testeable.** `scripts/catalog-diff.ts` no lee ni
  escribe archivos: recibe `{ prev, next }` y devuelve el reporte. El CLI solo hace I/O.
- **D6 — Se valida antes de escribir.** Si el raw no pasa la validación (forma, conteo, duplicados,
  o el conteo esperado del oráculo), **no se toca `public/data`**: nada de dejar el catálogo a medio
  actualizar. El orden es: leer el catálogo vigente → leer y validar el raw → recién ahí normalizar.
- **D7 — `public/data` sale del control de versiones.** Es dato generado, no fuente. Vive en el
  branch `datos`; el build lo inyecta en `dist/data/`, y el desarrollo local lo baja con
  `npm run fetch-data`. El build **falla ruidoso si falta**: un deploy sin catálogo es un sitio roto,
  y prefiere no publicar.
- **D8 — La fecha de los datos sale del raw, no del reloj.** `normalize` calcula `fecha` como el
  máximo de `actualizado` que pueda parsear; si no hay ninguno parseable queda `null` y la UI no
  muestra nada (principio del proyecto: no afirmar lo que el dato no sostiene).
- **D9 — Las etapas se commitean como unidades de trabajo separadas.** Etapa 1 (local, sin red ni
  credenciales) primero, porque es la que decide si un dato es publicable; recién después la
  extracción y la publicación.
- **D10 — La validación espeja el contrato de `normalize`, no lo endurece.** Corrección de un defecto
  de este mismo documento: la primera versión rechazaba todo `precio` que no fuera un número finito,
  pero `normalize` excluye a propósito los registros sin precio (`null`) y con `precio <= 0`. Ser más
  estricto que el pipeline hacía que **un solo precio nulo en un dump futuro acusara a la extracción
  de estar rota**. Ahora un precio ausente/nulo y un `precio <= 0` se **cuentan** (`sinPrecio`,
  `precioNoPositivo`) y solo falla un valor que no es un precio en absoluto. El parser espeja el
  `NUMBER_RE` de `normalize`: acepta `1234,50` y rechaza `1.234,50`, igual que él.

## Reglas de higiene (no negociables)

1. `raw-catalog.json` **nunca** se commitea, **nunca** se sube como artifact y **nunca** se imprime
   (ni una fila, ni un campo). Vive solo en el runner y muere con el job.
2. El script **nunca** imprime la contraseña, el token ni el cuerpo del login. Los logs dicen
   `login ok` / `login rechazado` y nada más.
3. **Un solo intento de login por corrida.** Sin retry, sin backoff: un job reintentando con una
   credencial vencida es la vía rápida al bloqueo de la cuenta.
4. Extracción **secuencial**: ~46 requests de a uno, sin paralelismo.
5. `trace`/`video` de navegador no aplican (no hay navegador en el diseño final).

## Allowed edit surfaces

Etapa 1 (este commit):
- `scripts/catalog-diff.ts` (nuevo), `scripts/catalog-diff.test.ts` (nuevo)
- `scripts/refresh-catalog.ts` (nuevo), `scripts/refresh-catalog.test.ts` (nuevo)
- `package.json` (una entrada en `scripts`)

Nada fuera de eso en esta etapa. En particular: `scripts/normalize-catalog.ts`,
`scripts/generate-index.ts`, `src/**` y `public/data/**` **no se tocan**. Este documento y el `todo`
los mantiene el orquestador (parent-owned), no el writer.

## Tasks

### Etapa 1 — refresh determinista (local: sin red, sin credenciales)

- [x] **T1** — `scripts/catalog-diff.ts` + tests: `validarProductos(productos, { esperado })`
  (forma de cada registro, conteo mínimo, duplicados por id, y —si se pasa— igualdad exacta con el
  conteo del oráculo) y `compararCatalogos(prev, next)` → conteo prev/next, altas, bajas, ids
  huérfanos, cambios de precio (cantidad, mediana y máximo del % de cambio, top 10 por magnitud),
  cobertura de EAN prev/next y EANs que desaparecieron, y categorías altas/bajas. Todo puro.
- [x] **T2** — `scripts/refresh-catalog.ts` + tests: el CLI. Lee el catálogo vigente, lee y valida
  el raw (`--esperado <N>` opcional), y **solo si pasa** corre `normalize` y `generate-index`; al
  final imprime el reporte. `--json` emite el reporte legible por máquina. Exit codes: `0` ok,
  `1` validación del raw, `2` conteo distinto del esperado, `3` fallo de un paso del pipeline.
- [x] **T3** — `package.json`: `"refresh": "node scripts/refresh-catalog.ts"`.
- [x] **T4** — Prueba de fidelidad contra los datos reales: `npm run refresh -- --esperado 23230`
  reprodujo el `public/data/catalogo.json` commiteado **byte a byte** (`version 1cc78a044e6fd67a`),
  con `git status` limpio en `public/data`. El reporte dio cero en todo: 23.230 registros crudos →
  20.331 productos, 2.899 excluidos por `precio <= 0`, 0 altas, 0 bajas, 0 huérfanos, 0 cambios de
  precio, 0 EANs perdidos. Esto cierra el hueco documentado en `.github/workflows/deploy.yml:53-58`
  ("CI no puede re-derivar el catálogo desde su fuente").

### Etapa 2 — extracción y publicación automática

- [x] **T5** — `scripts/kioskos-client.ts` (cliente HTTP con `fetch` inyectable, sin `fs`, sin
  `process.exit`, sin leer el entorno) + `scripts/extract-catalog.ts` (el CLI). El CLI lee
  `KIOSKOS_EMAIL`/`KIOSKOS_CLAVE` del entorno —así la credencial no se tipea nunca en una línea de
  comandos, que la dejaría en el history y en `ps`—, hace login, pide el oráculo, pagina de a 500
  **secuencialmente**, asserta `length === cuantos` **antes de escribir**, y escribe
  `raw-catalog.json` con la forma que `normalize` ya acepta. Imprime **a qué local quedó atado el
  token** y advierte si la cuenta tiene más de uno: eso es lo que resuelve R4 desde el propio job.
  Exit codes `0` ok · `1` login/argumentos · `2` API o escritura · `3` el conteo no coincide con el
  oráculo. `--tope`, `--out`, `--help`. Ningún reintento en ninguna ruta, y timeout de 15 s en cada
  request. **Evidencia**: 41 tests entre los dos archivos nuevos, suite completa 415/32/0.

### Verificación independiente de T5 (2026-10-02)

Antes del commit, un verificador con mandato explícito de **falsificar** (no de confirmar) atacó
cinco propiedades: que ningún secreto pueda escapar por stdout/stderr en ninguna ruta de error
(incluidos HTTP 401/500, body no-JSON, body con forma equivocada, timeout, argumentos inválidos y
excepciones no capturadas), que no se escriba nada antes del assert del oráculo, que no haya
reintentos ni paralelismo, que todo request esté acotado por un `AbortSignal`, y que los tests no
sean vacuos.

**Resultado: ninguna de las cinco pudo falsificarse**, pero encontró un defecto real y cuatro huecos
de test, todos cerrados en el mismo `ddb780d` y cada uno re-chequeado por inyección de fallas
(romper el comportamiento y ver el test ponerse rojo):

1. **Defecto real** — el `writeFileSync` quedaba fuera del manejador de errores del CLI, así que un
   fallo de escritura escapaba como stack crudo de Node. Ahora es una línea limpia y sale con `2`.
2. El test de login rechazado no pinnaba la ruta: con la URL apuntando a un puerto cerrado daba
   exactamente las mismas aserciones. Ahora exige un `POST /api/entrar`.
3. Los tests de "no escribió nada" usaban directorios vacíos, así que no distinguían "nunca
escribió" de "escribió y borró". Ahora usan un centinela cuyos bytes se comparan antes y después, y
   el caso de conteo distinto cubre también un `--out` explícito.
4. Nada pinnaba "un solo intento": ahora un reintento futuro rompe un test.
5. El timeout no estaba guardado por ningún test (solo por sondas manuales del verificador): ahora
   se asserta que login, conteo y cada página reciben un `AbortSignal` real.

**Lo que el verificador dejó declarado como NO verificado**: la discriminación del punto 5 contra un
cliente roto (el archivo estaba fuera de las superficies permitidas para esa tarea) y el
comportamiento de reintento interno de `undici`. Ninguna de las dos se reportó como verificada.
- [ ] **T6** — `.github/workflows/actualizar-catalogo.yml`: `schedule` (07:00 UTC = 04:00 AR) +
  `workflow_dispatch`. Pasos: checkout `main` → `npm ci` → `extract` con los secrets → `refresh`
  → commit de `public/data/*` al branch `datos` → disparo del deploy. Y **si algo falla, abre un
  issue**: un job diario que muere en silencio es peor que no tener job.
- [ ] **T7** — `deploy.yml`: agregar `repository_dispatch` (hoy el único trigger es un push a
  `main`), bajar el branch `datos` e inyectar los archivos en `dist/data/` antes de publicar. Sacar
  `public/data` del control de versiones y mudar a T6 el check "los assets de búsqueda corresponden
  al catálogo" (`deploy.yml:38-47`), que ahora vive donde se generan los datos.
- [ ] **T8** — `scripts/fetch-data.ts` + `"fetch-data"`: baja `public/data/*` del branch `datos` para
  el desarrollo local, porque `scripts/acceptance.ts` y `scripts/tune-threshold.ts` leen el catálogo
  real. El build falla ruidoso si falta.

### Etapa 3 — que el cliente se entere

- [ ] **T9** — `src/lib/catalogLoader.ts`: evictar las claves `?v=<versión vieja>` de la Cache API.
  Hoy cada versión nueva agrega claves y ninguna se borra (`catalogLoader.ts:157-163`): con un
  refresh diario, la cache de una PWA instalada crece para siempre.
- [ ] **T10** — Fecha de los datos visible: `normalize` escribe `fecha` en `catalogo.json`,
  `generate-index` la copia a `facets`, y Ajustes la muestra. Hoy no hay forma de saber si el job
  murió hace una semana.
- [ ] **T11** — Des-hardcodear los conteos que cada refresh invalida: `scripts/acceptance.ts:5-8,30`
  (20.331 productos y EANs fijos) y `sdd/05-acceptance-report.md`.

## Verificación por etapa

- **Etapa 1**: `npm run typecheck` limpio, `npm test` verde, y la prueba de fidelidad de T4 con la
  evidencia del `version` reproducido.
- **Etapa 2**: corrida manual del workflow (`workflow_dispatch`) mirada por el usuario; login desde
  la IP del runner es el riesgo abierto R1.
- **Etapa 3**: medición en navegador del `dataDate` visible y de la cache que no crece entre dos
  versiones.

## Riesgos abiertos

- **R1 — La IP del runner.** kioskos.app podría rechazar o tratar distinto un login desde un
  datacenter. No se puede saber sin probarlo: la primera corrida de T6 es manual y se mira. Plan B:
  runner self-hosted en un dispositivo del kiosco o en un VPS, que además devuelve la credencial al
  lado del usuario.
- **R2 — El secreto es la cuenta de dueño** (D3). Quien tenga permiso de escritura en el repo puede
  leerlo; los PR de forks no lo ven. Rotación documentada: se cambia la clave en el portal y se
  actualiza el secret (`gh secret set`).
- **R3 — Cron de Actions**: impreciso bajo carga, y GitHub desactiva los workflows programados tras
  60 días sin actividad en el repo. El commit diario al branch `datos` cuenta como actividad, así que
  solo importa si el job muere en silencio; de ahí la notificación por issue de T6.
- **R4 — ¿Un local o varios?** El token queda atado al negocio. **Mitigado en T5**: el CLI imprime a
  qué local quedó atado el token y advierte si la cuenta tiene más de uno, así que la primera corrida
  real lo responde sola. Queda pendiente **decidir** qué hacer si son varios (hoy se extrae el que el
  token tenga seleccionado), y que el reporte de diff diga cuál, o un `cuantos` distinto va a parecer
  un catálogo que se derrumbó.
- **R5 — Fuga por logs.** Regla 1 y 2 de higiene existen porque el repo es público; cualquier
  `console.log` que imprima filas publica el margen del usuario. Es el riesgo con peor relación
  daño/probabilidad de toda la feature.
- **R6 — Los listados completos del reporte. CERRADO (2026-10-02).** `idsHuerfanos` y
  `barcodesDesaparecidos` iban completos en el objeto (y por lo tanto en `--json`): en una caída
  catastrófica el payload podía rondar 1 MB. Ahora los dos son `ListaAcotada` — `conteo` exacto,
  `truncado`, y `valores` acotados a `MAX_LISTA = 200` — y la salida en prosa avisa cuando recorta.
  Importa porque el cuerpo del issue de T6 sale de ese JSON.
