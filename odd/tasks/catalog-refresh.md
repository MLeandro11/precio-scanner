# Feature: actualización diaria del catálogo desde kioskos.app (`catalog-refresh`)

**Status:** **Etapa 1 (T1-T4), T5, T6, T8, T12, T7, T13 y T9 hechas, verificadas y en producción.** El
ciclo completo corre solo: cron → login → extracción → validación → publicación en `datos` → dispatch
→ deploy → sitio, y el cliente ya no acumula versiones muertas del catálogo. **Corrió 3 veces sin
supervisión**: el 7 y el 9 en verde, y el 8 falló **seguro** por R8 (abrió el issue correspondiente y
no publicó nada), que ya está mitigado. Faltan T10 y T11 · **Started:** 2026-10-02
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
- [x] **T6** — `.github/workflows/actualizar-catalogo.yml`: `schedule` (07:00 UTC = 04:00 AR) +
  `workflow_dispatch`; permisos mínimos (`contents: write` para el branch, `issues: write` para el
  aviso); `concurrency` fijo sin cancelar (una corrida que ya extrajo no se desperdicia); checkout de
  `main` → `npm ci` → `npm run extract` con los secrets por entorno → `npm run --silent refresh --
  --json` (el `--silent` es necesario: el banner de npm sale por stdout y rompería el contrato de
  "un solo objeto JSON") → publica **solo** `public/data/*.json` en el branch `datos` → y si algo
  falla, **abre un issue**. El branch `datos` se arma en un repo descartable con plumbing
  (`hash-object`/`update-index`/`write-tree`/`commit-tree`): nunca se hace checkout de `datos` sobre
  el working tree, porque eso reemplazaría el árbol entero por contenido de solo datos y borraría el
  código a mitad del job. Un commit por corrida, sin force push, así el rechazo de un push cruzado es
  ruidoso en vez de reescribir el historial. **Evidencia**: YAML parseado y estructura verificada
  (triggers, permisos, `concurrency`, 7 pasos en orden, `if: failure()` al final); ninguna ocurrencia
  de `force` fuera de comentarios, refspec sin `+`, cero menciones a `raw-catalog` fuera del
  comentario de higiene, cero `upload-artifact`.

#### Primera corrida manual (2026-10-07): qué probó

Corrida `37573451884`, 44 s, **todos los pasos en verde**.

1. **R1 — CERRADO.** `login ok`: el login funciona desde la IP de un runner. Era el riesgo que no se
   podía resolver sin probar.
2. **R4 — CERRADO.** `local del token: CERCA PROCREAR`, sin advertencia de varios locales ⇒ la
   cuenta tiene **un solo local**.
3. `refresh` produjo el reporte y los tres JSON: 48 páginas, **23.553 registros exactamente iguales
   al oráculo**, 2.820 excluidos por `precio <= 0`.
4. **CERRADO.** El branch `datos` quedó con **exactamente** los tres archivos
   (`public/data/{catalogo,catalogo-index,catalogo-facets}.json`) y un commit raíz del bot: el fetch
   `--depth=1` más el push desde un repo superficial funcionaron.
5. **Pendiente:** que una segunda corrida agregue un commit en vez de ser rechazada (la hace el cron).
6. **Pendiente:** que un fallo forzado abra el issue.

**El primer diff real de la historia del catálogo**: 20.331 → **20.733** productos (+402), 516 altas,
114 bajas, **1.589 cambios de precio**, 118 EANs desaparecidos, 4 categorías nuevas. La distribución
de precios **no se movió** (mediana 2.600 → 2.700, máximo idéntico: 2.123.750), así que no hubo
ningún reescalado.

**Y de ahí salió R7** (ver riesgos): 44 de esos 1.589 cambios son anómalos y hay que confirmarlos
con el usuario **antes** de que T7 publique los datos.

**Orden de operaciones obligatorio**: los secrets se cargan **antes** de pushear este archivo. Si el
cron empieza a correr sin credenciales, va a fallar y a abrir un issue por día.
- [x] **T7** — El dato dejó de ser fuente y pasó a ser artefacto. `deploy.yml` ganó
  `repository_dispatch` (`catalogo-actualizado`), el job de deploy baja el catálogo del branch antes
  de construir y **falla fuerte si no puede**, el workflow de datos baja la punta de `datos` como
  `--baseline` (y si ese fetch falla, frena el job en vez de reportar `primeraCarga` todos los días),
  y `public/data` salió del control de versiones (`25f0171`).

  **Evidencia — todo en corridas reales del 2026-10-07:**
  1. **Producción ya sirve los datos nuevos.** Un deploy sin datos en el repo bajó el catálogo del
     branch (`commit 389a05fc`, 20.733 productos) y publicó: el sitio en vivo sirve
     `version 42fe8fa23b6e0a9b` con **20.733 productos**. Producción pasó de los precios de
     septiembre a los de octubre.
  2. El diff ahora mide **el delta diario**, no el artefacto de transición: `primeraCarga: false`,
     20.733 → 20.733, delta 0.
  3. El `repository_dispatch` funciona: la corrida del workflow de datos disparó el deploy
     (`37578690319`, verde) sin intervención humana. Es el último eslabón y era el único sin probar.
  4. El check "los assets corresponden al catálogo commiteado" **se eliminó**: con los datos fuera del
     repo ese diff siempre está limpio, así que habría pasado sin probar nada. Un check que pasa
     siempre es peor que no tener check.

  **Dos defectos encontrados en la revisión del orquestador, arreglados en el mismo bloque:**
  - `fetch-data` hacía `git fetch` **sin `--depth=1`**, o sea se bajaba la historia entera del branch
    `datos` en cada deploy —y ese branch suma un commit con megas de JSON por día, para siempre—.
    El test pinneaba la lista de argumentos vieja, que es exactamente por qué sobrevivió.
  - `refresh` usaba `--catalogo` como baseline **y** como destino, así que pasarle un temporal habría
    hecho que `normalize` escribiera ahí y `public/data` nunca se actualizara. Ahora `--baseline`
    separa las dos cosas, y un baseline explícito ilegible es fatal (exit 3) en vez de degradar a
    `primeraCarga`.
  **Acoplamiento que dejó T6 y T7 tiene que resolver**: hoy el baseline del diff sale del
  `public/data` commiteado en el checkout. Cuando los datos se muden al branch `datos`, el paso de
  `refresh` tiene que tomar el baseline de la punta de `datos` (copiar `catalogo.json` a un temporal
  y pasarlo por `--catalogo`) o **todos los días el reporte va a decir `primeraCarga`** y el diff
  deja de servir para lo único que existe: decirte qué cambió. T6 ya lo dejó comentado en el paso.
- [ ] **T8** — `scripts/fetch-data.ts` + `"fetch-data"`: baja `public/data/*` del branch `datos` para
  el desarrollo local, porque `scripts/acceptance.ts` y `scripts/tune-threshold.ts` leen el catálogo
  real. El build falla ruidoso si falta.

### Etapa 3 — que el cliente se entere

- [x] **T9** — `src/lib/catalogLoader.ts`: el prune de las claves `?v=` viejas de la Cache API. Los
  archivos pesados se cachean con la versión de datos en la clave, que es lo que da la invalidación
  automática —pero **nadie borraba las claves viejas**, así que con un refresh diario una PWA
  instalada sumaba ~5,5 MB por día, para siempre—. Ahora, después de una carga exitosa, el loader
  borra toda entrada cuyo `?v=` no sea el de la versión en uso. **Sobreviven por construcción** las
  entradas de la versión actual (el prune corre sobre lo que no se está sirviendo) y el
  `catalogo-facets.json`, que no lleva `v` y es el fallback offline del que depende todo el boot.
  Corre **solo después de tener los dos archivos pesados en mano**, así que una carga que falla a
  mitad no toca el último juego que funcionaba, y cualquier error del prune se traga: la limpieza no
  puede ser la razón por la que alguien se queda sin app.

  **Evidencia**: 475 tests / 33 archivos / 0 fallos, typecheck limpio, y —lo que más importa acá—
  **verificado en un navegador real**, porque los tests usan una cache falsa y la Cache API solo
  existe en un contexto de navegador. Con el server de dev levantado: la app cargó y dejó las tres
  entradas esperadas; sembré **a mano** dos entradas con un `?v=` viejo y recargué; quedaron
  exactamente las dos de la versión actual más el facets, las viejas desaparecieron y la app siguió
  buscando. Commiteado en `89bab63`.
  **No cubierto**: el boot offline en un navegador de verdad (necesita un build de producción con el
  service worker activo; en dev no hay SW). El camino offline sí está cubierto por tests.
- [ ] **T10** — Fecha de los datos visible: `normalize` escribe `fecha` en `catalogo.json`,
  `generate-index` la copia a `facets`, y Ajustes la muestra. Hoy no hay forma de saber si el job
  murió hace una semana.
- [ ] **T11** — Des-hardcodear los conteos que cada refresh invalida: `scripts/acceptance.ts:5-8,30`
  (20.331 productos y EANs fijos) y `sdd/05-acceptance-report.md`.
- [x] **T12** — El reporte explica sus propias anomalías. `compararCatalogos` acepta un mapa
  opcional de las fechas del raw y agrega la sección `cambiosGrandes`: cuántos cambios superan
  `UMBRAL_GRANDE = 50%`, cuántos de esos traen un `precioCambiado`, y hasta diez ejemplos anotados
  con las dos fechas. `refresh-catalog` arma ese mapa del raw que ya lee, así que desde ahora el
  reporte se explica solo. **Lo honesto es el default**: sin mapa de fechas, `fechasDisponibles` es
  `false` y los dos conteos son `null`, **nunca 0** —no saber se reporta como no saber—.
  **Evidencia**: 429 tests / 32 archivos / 0 fallos, typecheck limpio, y un smoke sobre el raw real de
  23.230 registros y el catálogo real de 20.733 productos (100 cambios >50%, 1 con fecha), no solo
  fixtures. Commiteado en `328ee09`.
- [x] **T13** — Sacarle el día perdido a R8, en las **tres** direcciones del corrimiento. El
  extractor valida cada recorrido completo con el mismo `validarProductos` puro que usa el refresh
  —así la regla vive en un solo lugar— y **reintenta un solo recorrido más** cuando el resultado es
  inválido; si el segundo también falla, imprime los motivos y sale con `3` sin escribir nada. Nunca
  se reintenta un login (esa regla existe por el bloqueo de cuenta, y el reintento recorre de nuevo
  **con la sesión que ya tiene**: un solo `POST /api/entrar` por corrida en todos los escenarios) ni
  un fallo de API (exit 2, sin segundo recorrido). **No deduplica y publica**: el duplicado es el
  síntoma visible de un salteo invisible.

  **La verificación independiente encontró que faltaba una dirección.** El guard de runaway del
  cliente cortaba apenas el total superaba el oráculo, así que un recorrido con **una fila de más**
  —la firma de un producto **agregado** a mitad de camino, y la dirección más probable para un
  catálogo que crece— nunca llegaba a la validación y no se reintentaba. Ahora corta solo si el total
  supera al oráculo por **más de una página entera** (`cuantos + tope`): un corrimiento no puede
  producir eso, y una API que ignore `desde` lo sigue disparando. La reproducción del verificador es
  un test.

  **Evidencia**: 469 tests / 33 archivos / 0 fallos, typecheck limpio. El verificador no pudo
  falsificar que el login nunca se repite, que son como máximo dos recorridos, que no se escribe
  nada cuando los dos fallan y que ningún secreto llega a stdout/stderr. Commiteado en `1f956ea`.

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
  Importaba porque el cuerpo del issue de T6 sale de ese JSON.
- **R7 — 44 cambios de precio anómalos, a confirmar antes de publicar (2026-10-07).** De los 1.589
  cambios medidos en la primera corrida, 44 superan +100% o caen por debajo de -50%, con casos como
  `JUGO CITRUS IVESS CORMILLOT X 1.5L` 33 → 8.600, `TALITAS CON QUESO X 140` 20 → 2.500 o
  `ALMOHADITAS CHOCOL LASFOR X 180G` 63 → 2.600.

  **Qué se descartó, con evidencia:**
  - *No es un reescalado.* La distribución general no se movió (mediana 2.600 → 2.700, máximo
    idéntico: 2.123.750) y los multiplicadores de los 44 son **todos distintos** (260×, 125×, 41×,
    39×, 30×, 26×, 25×). Un bug de unidad daría un factor constante. Los valores nuevos son precios
    de góndola redondos (8.600, 2.500, 2.600, 3.500, 800); los viejos no.
  - *No es duplicación de ids.* De los 12 peores, solo **1** tiene un hermano con el mismo nombre, y
    0 con el mismo EAN.
  - *No es "precios estancados".* Esa fue mi primera lectura y **el campo `actualizado` la
    falsifica**: va del 2026-07-31 al 2026-09-03 con mediana 2026-08-03 **para los 23.230
    registros**. Es "última escritura del registro", no "último cambio de precio", y no distingue
    nada: ni los anómalos ni los sin cambio se separan de esa distribución.

  **El campo que sí importa es `precioCambiado`** (punta del usuario, y estaba en lo cierto):
  presente en 1.091 de 23.230 registros, **todos** entre 2026-08-25 y 2026-09-03, 980 de ellos
  idénticos a `actualizado` ⇒ marca una actualización masiva de precios, no un cambio individual.
  Pero **tampoco explica los 44**: solo **1 de los 44** lo trae, contra 133 de 1.545 en los cambios
  normales y 954 de 18.628 en los que no cambiaron.

  **Conclusión honesta:** la firma de los datos (factores distintos, valores nuevos redondos) es la de
  **correcciones individuales de precio**, no la de una transformación del pipeline. Pero la prueba
  definitiva está en los campos de fecha del raw **nuevo**, y ahí el pipeline se los come: `normalize`
  descarta `actualizado`, `precioCambiado` y `cartelImpreso`, y el raw del runner es efímero. Por eso
  T12.

  **CERRADO el 2026-10-07, y a favor del usuario.** El reporte anotado que habilitó T12 mostró que
  los 100 cambios grandes tienen `actualizado` **posterior al máximo de todo el catálogo viejo**
  (2026-09-03) ⇒ esos productos se escribieron después de la extracción vieja. Son correcciones
  reales hechas en el POS entre septiembre y octubre, y los precios mal cargados eran los viejos.
  `precioCambiado` no los marcaba porque no significa "el precio cambió". La decisión del usuario de
  seguir sin esperar el veredicto quedó respaldada por la evidencia en vez de por su autoridad.
- **R8 — La paginación por offset corre una carrera contra un catálogo que cambia. Observado en
  producción el 2026-10-08.** Esa corrida falló en la validación con un id duplicado en los índices
  **1499 y 1500**, el borde exacto entre la página 3 y la 4. No es un producto duplicado en el
  sistema: ese id aparece **una sola vez** en los catálogos del 7 y del 9. Es la firma de un
  corrimiento de offsets, porque la extracción recorre `desde=N&tope=500` durante ~40 s sobre datos
  mutables y, si alguien agrega o borra un producto en el medio, una fila puede aparecer dos veces
  —o saltearse—. **Las dos direcciones están cubiertas**: el duplicado por `id-duplicado`, y el
  salteo porque el conteo total no cerraría contra el oráculo `/api/productos-cuantos`. Por eso nunca
  se publicó un catálogo roto: el costo es un día perdido. **El duplicado es la parte visible; el
  salteo es la silenciosa, y la validación es lo único que lo delata.** Pasó 1 de cada 3 corridas
  programadas hasta ahora. **Las tres direcciones del corrimiento quedaron cubiertas por T13**
  (duplicado con salteo, salteo solo, y una fila de más por un producto agregado a mitad de camino).
- **R9 — El cron de GitHub corre ~7 horas tarde.** Las corridas programadas cayeron a las 14:07,
  14:22 y 14:12 UTC en vez de a las 07:00: el scheduler de Actions es best-effort y posterga los
  repos de baja actividad. Consecuencia práctica: los precios se actualizan alrededor de las 11 de la
  mañana hora argentina, no antes de abrir. No rompe nada —el dato del día llega igual— pero conviene
  saberlo antes de confiar en el horario. Mitigaciones posibles: aceptarlo, agregar una entrada de
  cron más temprana, o dispararlo desde afuera.
