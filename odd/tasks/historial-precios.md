# historial-precios

**Historial de precio por producto en Lupa.** El dato existe desde el 2026-10-07 (una foto diaria
del catálogo en el branch `datos`), pero nunca hubo camino de entrega ni serie por EAN: `/historial/:ean`
es un placeholder honesto. Esta feature publica la serie y la dibuja.

**Regla que ordena todo**: el historial se sirve **reconstruyendo hacia atrás desde el precio de hoy** con
un log acumulativo de cambios, **nunca** copiando los snapshots completos (3.309 KB/día contra ~8 KB/día).

## Specs

- **S1** (pedido, ver L1, verbatim): *"podriamos hacer el historial de cada producto no?"*
- **S2** (decisión del usuario, L3, verbatim): *"Todo lo que haya, sin recorte"* — la ventana es todo lo que
  exista desde la primera corrida; el archivo crece con el tiempo y no se recorta.
- **S3** (decisión del usuario, L3, verbatim): *"Gráfico + lista de movimientos"* — la pantalla muestra un
  gráfico de la serie **y** la lista de los días en que el precio cambió, cada uno con fecha, precio y %.
- **S4** (decisión del usuario, L3, verbatim): *"Solo desde el detalle del producto"* — el único acceso es
  `/producto/:ean → Ver historial`; `/cambios` y el panel de escaneados no enlazan en esta entrega.
- **S5** (hallazgo del 2026-10-28, ver L9): *una fila malformada no puede tirar el archivo entero.* El
  cliente y el pipeline **descartan la fila y conservan las válidas**; ninguno rechaza el artefacto
  completo por una fila. Un barcode que no es EAN (dígitos, ≥6) no entra al log ni se dibuja.
  Prohibido "arreglar" esto rechazando el archivo actual: el log es acumulativo y reiniciarlo borra la
  historia (R4).
- **S6** (decisión del usuario, L10, verbatim): *"La última lectura del catálogo"* — cuando el catálogo
  trae varias filas del mismo EAN con precios distintos, el "precio de hoy" que cierra la serie es el de
  la **última** fila del arreglo, la misma regla que ya aplica el log al escribir cada día.

## Reglas que el sistema exige (no son pedidos: son las leyes ya escritas del repo)

- **R1 — Peso y caché.** El archivo se pide **solo** al abrir la pantalla, `network-first` con fallback
  offline (patrón de `facets`/`cambios`), **nunca** con `?v=` (la ley de T9: el prune borra claves viejas), y
  **no** entra al precache de la PWA: no es un dato de arranque.
- **R2 — Huecos honestos.** Un día sin entrada no es "el precio no cambió": puede ser que la corrida falló,
  que el pipeline no existía, o que el producto no estaba en el catálogo. El gráfico **no** inventa
  continuidad: los tramos sin dato se nombran ("sin datos del 12 al 14"), y un producto que aparece por
  primera vez arranca ahí, sin puntos anteriores.
- **R3 — Verde/rojo no son la única señal.** La variación lleva signo y flecha, no solo color (la ley de
  accesibilidad que ya siguen las filas de `/cambios`).
- **R4 — El pipeline no puede perder el log.** Es un archivo acumulativo en el branch `datos`: si una corrida
  no lee el anterior, el historial nace de nuevo y miente. Misma defensa que el artefacto de cambios:
  baseline separado del destino, y un push sin `--force`.

## Tasks

| ID | Specs | Tarea | Ruta | Commit |
| --- | --- | --- | --- | --- |
| **T1** | S2, R4 | `scripts/historial.ts` (puro): append del día al log acumulativo, con dedupe por EAN y validación de forma; tests | inline | `bd3a00a` |
| **T2** | S2, R4 | `refresh-catalog.ts` publica `historial.json` (baseline separado del destino, sin force) + `fetch-data` lo baja | inline | `bd3a00a` |
| **T3** | S3, R1 | Cliente: tipos + loader del archivo (network-first + fallback, sin `?v=`) | inline | `8c3bae8` |
| **T4** | S2, S3, R2 | `src/lib/historial.ts` (puro): reconstruir la serie de un EAN desde el log, con huecos explícitos; tests | inline | `8c3bae8` |
| **T5** | S3 | Pantalla real de `/historial/:ean`: gráfico SVG a mano, precio, variación y lista de movimientos; reemplaza el placeholder | inline | |
| **T6** | S4 | Acceso desde el detalle del producto | inline | ya existía (`ProductPage.tsx:129`): verificado, sin cambios |
| **T7** | todas | Verificación: focal, suite, typecheck, acceptance (fila nueva) y navegador real con datos servidos | verify | |
| **T8** | S5, S6, R2, R4 | Tolerancia de fila malformada en cliente y pipeline (sin rechazar el archivo), filtro de barcodes no-EAN al escribir y al releer el baseline, y precio de hoy en la pantalla | worker + verify | |

## Log

- **L1** (usuario, 2026-10-23, verbatim, origen de la feature):
  > podriamos hacer el historial de cada producto no?

- **L2** (orquestador, 2026-10-23, medición antes de diseñar): el diff diario publicado pesa **47 KB para
  7 días / 455 filas** (`public/data/catalogo-cambios.json`), o sea ~8 KB por corrida; el snapshot completo
  pesa **3.309 KB por día**. Proyección: 30 días ≈ 234 KB, 90 días ≈ 701 KB. **Conclusión: la serie se sirve
  con un log de cambios, no con snapshots.** No hay librería de gráficos en el repo (`chart/d3/recharts/visx:
  ninguna`), así que el gráfico es SVG a mano. `HistorialPrecio` ya existe como tipo (`src/lib/lupa/list.ts:30`)
  y `/historial/:ean` ya existe como ruta con placeholder honesto.

- **L3** (usuario, 2026-10-23, respuestas del selector, verbatim): **ventana** *"Todo lo que haya, sin
  recorte"* · **contenido** *"Gráfico + lista de movimientos"* · **acceso** *"Solo desde el detalle del
  producto"*.

- **L4** (orquestador, 2026-10-23, diseño derivado de L2/L3 y de las leyes del repo): se publica
  **`historial.json`** en el branch `datos`, acumulativo, con un bucket por día (`{fecha, cambios:[{ean,
  precio}]}`) donde `precio` es el precio **después** del cambio de ese día. La serie de un EAN se
  reconstruye hacia atrás desde su precio de hoy: cada entrada del log es un punto. Un día sin entrada no se
  rellena (R2). La pantalla no depende de `Mi lista` ni de la sesión: es de solo lectura.

- **L5** (orquestador, 2026-10-23, lo que encontró la corrida end-to-end con el raw real): `npm run
  refresh` contra `raw-catalog.json` (17 MB) escribiendo a `/tmp` produjo `historial.json` de 1 día y
  destapó dos defectos que ningún fixture veía: **(a)** el catálogo trae el mismo EAN en varios
  registros (la misma fila repetida 3 veces), así que el log guardaba puntos duplicados — ahora es
  **una fila por EAN y por día** (gana la última lectura si discrepan, regla determinista, no un
  empate silencioso); **(b)** un archivo previo ausente se reportaba como `not-an-object` en vez de
  `absent`, confundiendo "no hay historia" con "hay basura". Después del arreglo: **77 filas, 0
  duplicados, 2.682 bytes** por día (más barato que la proyección de 8 KB, porque la fila es solo
  `ean`+`precio`). **Lección**: el e2e con el dato real es lo único que destapa la forma real del
  catálogo; los fixtures limpios no.
- **L6** (orquestador, 2026-10-23): `fetch-data` tolera la ausencia de `historial.json` en el guard de
  build hasta que el branch lo publique (`PENDIENTES_DE_PUBLICAR`, con la regla de borrar la entrada
  apenas exista). Exigirlo antes deja el deploy rojo por un archivo que todavía no nació. Hay un test
  que fija esa tolerancia para que el cambio a "exigido" sea deliberado. El workflow no necesitó
  cambios: publica `public/data/*.json` por glob.

- **L7** (orquestador, 2026-10-23, lo que destapó ver la pantalla con datos): el gráfico, medido en
  Chromium a 390×844 con un artefacto de 8 días, mostró **5 puntos, 0 líneas y 4 avisos de "sin
  datos"**. La causa era de diseño, no de CSS: el log **solo publica los días en que el precio
  cambió**, así que marcar como hueco cualquier salto de días convertía cada serie en puntos sueltos.
  La distinción correcta la tiene el propio artefacto: un día con bucket y sin fila para ese EAN es
  **"corrió y el precio se mantuvo"** (la línea lo cruza), y un día **ausente** es **"no hay dato"**
  (la línea se corta y el rango se nombra). Después del arreglo: 5 puntos, **2 tramos**, 2 huecos
  nombrados. Otras tres correcciones de la misma revisión visual: el precio suelto sin etiqueta pasó a
  "Último precio registrado" + número grande; `Sin datos del 15 oct al 15 oct` colapsó a `Sin datos
  del 15 oct`; y `↓ +3,33 %` (flecha y signo contradiciéndose) pasó a `↓ 3,33 %` (flecha + magnitud),
  con un test que prohíbe `↓ +`. **Lección**: un gráfico no se verifica con tests de DOM; hay que
  mirarlo con datos reales, porque el defecto estaba en la semántica de los datos.
- **L8** (orquestador, 2026-10-23): la fila de aceptación **`HIST-screen`** no exige `ready`, porque el
  log se publica recién en la próxima corrida: verifica que la pantalla **nombre su estado** y que
  **nunca dibuje un gráfico sin datos** (si `absent`, cero puntos y el copy honesto; si `ready`,
  puntos > 0). El fixture visual usado para medir se inyectó en `public/data/historial.json` y se borró
  al terminar: dejarlo habría hecho que la app mintiera con datos inventados.

- **L9** (orquestador, 2026-10-28, verificación en Chromium con el artefacto **real** publicado, no con
  fixtures): la pantalla está **rota en producción para todos los productos**, y no por el gráfico: el
  `historial.json` publicado tiene 823 filas y **7 con barcode que no es EAN** (`HG`, `1890X4`, `AM`,
  `SPAM`, `2BH`, `2BR`, `2Q` — basura que existe en el catálogo del POS). El cliente valida el archivo
  completo (`src/lib/historial.ts:113`, `dias.every(isDia)` → `cambios.every(isCambio)` → `isEan`), así
  que una fila mala devuelve `null` y la pantalla queda en `invalid`: 3 EANs × 2 viewports dieron **0
  puntos y 0 movimientos** con el copy "El historial publicado no se pudo leer". Quitando esas 7 filas,
  el mismo archivo renderiza `ready` con 5 puntos y 3 movimientos. El pipeline sigue publicándolas
  (`scripts/historial.ts:108` acepta cualquier barcode no vacío). **Segundo defecto de la misma
  medición**: `HistoryPage.tsx:229` pasa `null` como precio de hoy, así que el punto de hoy es código
  muerto y un producto sin filas en el log (7UP LATA 354, $1.500) dibuja 0 puntos, muestra `—` y afirma
  "Todavía hay un solo día registrado". Avisos: copy "no cambió de precio" duplicado con 0 puntos, eje de
  un solo punto con `27 oct` en ambos extremos, y **88 EANs con más de una fila en `catalogo.json`** (el
  peluche del ejemplo tiene 6: cinco a 19.500 y una a 19.496). **Lección repetida de L5/L7**: los fixtures
  limpios y el DOM no ven esto; el dato real sí.

- **L10** (usuario, 2026-10-28, respuestas del selector, verbatim): **alcance** *"Los dos bloqueantes,
  completo"* · **precio de hoy** *"La última lectura del catálogo"*.
