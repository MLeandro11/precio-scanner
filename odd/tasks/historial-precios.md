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
| **T3** | S3, R1 | Cliente: tipos + loader del archivo (network-first + fallback, sin `?v=`) | inline | |
| **T4** | S2, S3, R2 | `src/lib/historial/serie.ts` (puro): reconstruir la serie de un EAN desde el precio de hoy + log, con huecos explícitos; tests | inline | |
| **T5** | S3 | Pantalla real de `/historial/:ean`: gráfico SVG a mano, precio, variación y lista de movimientos; reemplaza el placeholder | inline | |
| **T6** | S4 | Acceso desde el detalle del producto | inline | |
| **T7** | todas | Verificación: focal, suite, typecheck, acceptance (fila nueva) y navegador real con datos servidos | verify | |

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
