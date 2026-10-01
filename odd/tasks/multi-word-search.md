# Feature: búsqueda multi-palabra = "todas las palabras" (tarea 7.7)

**Status:** done (implementado y verificado; **sin commitear**) · **Started / closed:** 2026-10-01
**Branch:** `main` (el repo commitea sobre `main`; no se creó feature branch)
**Origen:** `sdd/04-tasks.md` tarea **7.7**, revelada por el sweep de 7.1.

## Goal

Que una consulta de varias palabras exija **todas** las palabras: `coca 2,5` debe significar
"coca **AND** 2,5". Antes `src/lib/searchEngine.ts` le entregaba la consulta cruda a Fuse como **un
único patrón fuzzy**, así que la consulta no era un AND.

## Resultado medido sobre el catálogo real (20.331 productos)

| consulta | antes | después | precisión top-10 antes → después |
| --- | --- | --- | --- |
| `coca 2,5` | **MISS** (fuera del top 50) | **#4** | 0/10 → 2/10 |
| `zero 1,5` | #5 | **#1** | 1/10 → **8/10** |
| `quilmes 1890` | #1, total 50 | #1, total **6** | 6/10 → 6/10 |
| `yogurt griego` | #1 | #1 | 1/10 → **10/10** |
| `coca cola` | #1, total 158 | #1, total 1251 | — |
| `serenisma` / `cocacola` | #1, 10/10 | #1, 10/10 | sin cambio |

Costo por consulta (mejor de 5, mismo índice commiteado), medido por la **verificación
independiente**; el número de tokens manda:

| tokens | consulta | antes (patrón único) | después |
| --- | --- | --- | --- |
| 1 | `cocacola` | 235 ms | 198 ms |
| 2 | `coca cola` | 278 ms | 157 ms |
| 2 | `coca 2,5` | 169 ms | 148 ms |
| 3 | `coca cola 2,5` | 280 ms | 152 ms |
| 4 | `yerba mate playadito 1kg` | 650 ms | 106 ms |
| 5 | `gaseosa coca cola zero 1,5` | 884 ms | 173 ms |
| 8 | `coca cola yerba mate fideos arroz leche pan` | 2270 ms | 121 ms |

El índice commiteado (`public/data/catalogo-index.json`) **sigue válido**: `useExtendedSearch` cambia
el parseo del patrón, nunca la indexación.

## Hallazgos que deciden la implementación

1. **El candidato medido en la tarea 7.7 era `useExtendedSearch` desnudo, y desnudo es peligroso.**
   Extendido interpreta el texto del usuario como lenguaje de consulta. Medido sin neutralizar:
   `!coca` → **20.294** (todo el catálogo), `"a"` → **20.331**, `coca|zero` → 2.478, `=coca` → 0.
   El catálogo tiene **61** nombres con algún metacaracter (`' $ ! = ^ | " \`), 56 de ellos con
   `'`, `$`, `!` o `=`.
2. **La neutralización que la tarea pedía ("input escaping") funciona, y está probada, no
   supuesta.** Regla: dividir en tokens por espacio y envolver cada token en comillas dobles
   (`"token"`), porque un token entrecomillado siempre resuelve al matcher fuzzy, cuyo patrón es el
   texto interno pasado a Bitap: **literal**. `|` es el único operador que sobrevive dentro de las
   comillas, y se escapa con `\|`, el único escape que Fuse soporta.
   - Falsificación exhaustiva (mía, exploratoria): **11.110** cadenas generadas (largo 1..4 sobre
     `a b " \ | ! = $ ^ '`), comparando ids **y scores a 9 decimales** contra el camino crudo:
     **0 divergencias**.
   - Sobre el catálogo real (mía): **67** cadenas adversariales — sondas de operador + nombres y
     tokens con metacaracteres — con **0 divergencias**.
   - La verificación independiente rehizo la prueba desde cero con su propio modelo de referencia y
     una **población distinta**: 11.110 cadenas (forma del parser + literalidad contra
     `BitapSearch`), 11.110 sobre un chunk de docs reales, **29** tokens con metacaracteres del
     catálogo (la derivación estricta: tokens que *ellos mismos* llevan el metacaracter), **61**
     nombres con metacaracteres, 232 pares token×palabra y 150 muestras del corpus completo:
     **0 divergencias**, y un **control negativo** que prueba que el método sí detecta la
     divergencia (`!coca` 20294≠37, `=coca` 0≠37, `"a"` 20331≠2). Sus dos primeras "divergencias"
     resultaron ser un artefacto de su propio modelo de referencia (AND por campo, no por clave).
   - El harness (`scripts/tune-threshold.ts`) corre la equivalencia **en vivo sobre el catálogo**
     con **38 sondas** (9 de operador + 29 tokens del catálogo) y **falla su veredicto** ante
     cualquier diferencia. Se prefirió equivalencia contra el motor crudo antes que un techo
     máximo de resultados: el techo solo atraparía la explosión (`!coca`), no el colapso
     (`=coca` → 0).
3. **Un agujero real, encontrado y cerrado: NUL.** El parser de Fuse hace
   `.replace(/\u0000/g, "|")` internamente, así que un `\0` escapa a las comillas y se vuelve un
   `|` (medido: `"\0"` crudo matchea un doc con NUL; neutralizado matchea un doc con `|`). Regla
   adoptada: los caracteres de control (U+0000–U+001F, U+007F) son **separadores**, igual que el
   espacio, y nunca llegan al parser. Una consulta de solo caracteres de control tokeniza a nada →
   **0 resultados**, nunca el listado completo.
4. **El por-token con fusión de scores no se adopta, y se descarta con números.** Es la familia que
   la tarea había medido como peor ("set intersection"); su variante con orden de relevancia da
   ranks idénticos al candidato adoptado en las 4 consultas, pero 1,5–2× más lenta (2 tokens:
   211 ms vs 131 ms; 8 tokens: 685 ms vs 93 ms) y con una función de ranking propia (suma de
   scores) en lugar de la de Fuse. No se necesitó.
5. **El highlighting sobrevive (FR-2.6).** Bajo extended search, `matches[].indices` llega con la
   unión de los rangos de los tokens, ya ordenada y sin solapamiento (medido: `coca cola 2,5` →
   `[0-3 5-8 18-19]`; `"sereni" "sima"` → `[[0,9]]`). Igual se endureció `matchPositions` con un
   merge propio (`mergeRanges`): el scout mostró que `HighlightedName` **duplica texto** con rangos
   solapados, y con multi-palabra esa garantía deja de ser de Fuse y pasa a ser nuestra.
6. **Nada de la superficie se rompió.** El short-circuit de barcode se evalúa sobre la consulta
   cruda (un token de puros dígitos ⇒ comportamiento idéntico), `FR-2.8b` (`779 3940 219009`) sigue
   entrando por ahí y `FR-2.8d` (`EAN 7793940219009`) sigue en 0. Para un solo token el camino nuevo
   es **equivalente** al anterior, así que AC-2, AC-3, OFFLINE y DEEP-* no cambiaron.

## Decisions taken by the orchestrator (reversible; correctable by the user)

- **D1 — AND estricto, sin relajación silenciosa.** Si una palabra no matchea nada, la consulta
  devuelve 0 y se ve el estado vacío que ya existe. Medido: `coca zzzzz` → 0 en todos los
  thresholds. Un fallback a OR presentaría como dato algo que el usuario no pidió.
- **D2 — Un solo motor extendido, no dos caminos.** Con la neutralización probada, el camino de un
  token es idéntico al de antes, así que no hay rama por cantidad de tokens ni dos instancias de
  Fuse. La equivalencia queda pinneada por test.
- **D3 — La semántica vive en el motor; el harness mide ese mismo camino.** `buildQueryPattern` es
  la única fuente del patrón y `scripts/tune-threshold.ts` la importa (invariante ya declarada en
  la cabecera de ese archivo).
- **D4 — La prueba de neutralización vive en el catálogo**, no en una constante mágica.
- **D5 — Docs actualizados**: `PRODUCT.md`, `sdd/03-design.md` (pipeline + fila de riesgo) y
  `sdd/04-tasks.md` (7.7 → done con evidencia).
- **D6 — Sin commits.** El pedido del usuario no los autorizó; el árbol queda listo para revisión.

## Allowed edit surfaces

- `src/lib/searchEngine.ts`, `src/lib/searchEngine.test.ts`
- `scripts/tuning-queries.ts`, `scripts/tune-threshold.ts`
- `scripts/acceptance.ts`
- `PRODUCT.md`

`odd/`, `sdd/` y el `todo` los mantiene el orquestador (parent-owned), no el writer.
No se tocó `public/data/*` (el índice sigue válido), ni el modelo de datos, ni `HighlightedName`.

## Tasks

- [x] **T1** — `src/lib/searchEngine.ts`: `tokenizeQuery` / `escapeExtendedToken` /
      `buildQueryPattern` (puras y exportadas), `useExtendedSearch: true` en `FUSE_OPTIONS`,
      `mergeRanges` en `matchPositions`, short-circuit de barcode intacto sobre la consulta cruda.
      — Evidencia: `src/lib/searchEngine.ts` (+86).
- [x] **T2** — `src/lib/searchEngine.test.ts`: 11 casos nuevos (AND, equivalencia de un token contra
      motor crudo, NUL como separador y nunca como `|`, control-only → 0, `mergeRanges`, rangos de
      dos tokens ordenados y sin solape, composición con filtros/ids/paging, estricto sin fallback).
      **20 casos existentes intactos** (el orquestador había dicho 18; el writer corrigió el número).
      — Evidencia: 31 tests en el archivo, 214 en total.
- [x] **T3** — `scripts/tuning-queries.ts` (`OPERATOR_PROBES`) + `scripts/tune-threshold.ts`: el
      sweep mide el camino enviado y agrega el bloque de **seguridad por equivalencia**.
      — Evidencia: 38 sondas, todas `ok`, veredicto `tightest passing 0.35`, producción dentro de la banda.
- [x] **T4** — `scripts/acceptance.ts`: fila `SEARCH-multi-word` (`coca 2,5`, top-10).
      — Evidencia: **PASS**, 2/10 (antes 0/10).
- [x] **T5** — Docs: `PRODUCT.md`, `sdd/03-design.md` (paso del pipeline + fila de riesgo nueva),
      `sdd/04-tasks.md` (7.7 → done).
- [x] **T6** — Verificación (ver abajo).

## Verificación

Corrida por el orquestador y repetida por `gentle-ai-verify` (read-only, sin tocar el repo):

- `npm run typecheck` — limpio.
- `npm test` — **18 archivos / 214 tests**, todos en verde.
- `npm run build` — ok (13,8 s; precache 17 entradas; `404.html` byte a byte).
- `npm run acceptance` — **53/53** (52 PASS + 1 INFO `FR-2.8d` + **0 FAIL**). Sin regresiones:
  `AC-2` 10/10, `AC-3` 10/10, `SEARCH-multi-word` PASS, `FR-2.8a/b/c` PASS, `FR-2.8d` INFO,
  `NAV-back`, `OFFLINE`, `DEEP-search`, `DEEP-reload` PASS, `AC-5` PASS (peor frame gap 33 ms).
- `node scripts/tune-threshold.ts` — tabla de ranks/precisión a 0.35 y bloque de seguridad: 38/38 `ok`.
- Falsificación de la neutralización — 0 divergencias (detalle en el hallazgo 2).
- Lectura adversarial de `runQuery` línea por línea: consulta de solo espacios → browse-all (como
  antes), de solo control → 0, barcode con separadores → 1 hit exacto, dos tokens con
  `limit/offset/categoria/ids/priceMin/priceMax/sort` → componen bien, `sort` no muta
  `engine.products`, `mergeRanges` es puro y no tiene off-by-one. **Ningún input devuelve resultados
  equivocados.**

## Hallazgo abierto, preexistente y fuera de alcance

- **`R3-HIGHLIGHT-OFF-BY-ONE`** (`src/components/HighlightedName.tsx:26`): los rangos de Fuse son
  **inclusivos** `[start, end]`, pero el componente renderiza `nombre.slice(start, end)`
  (exclusivo), así que **el último carácter de cada match no queda marcado** (en el catálogo real,
  `COCA COLA 1.75` con rango `[0,3]` marca `COC`). El carácter no se pierde: `cursor` avanza hasta
  `end` y el siguiente span lo re-emite como texto plano, así que es puramente visual. El archivo no
  está en este diff (intacto desde `86c6846`): 7.7 no lo introdujo ni lo empeoró — `mergeRanges`
  mantiene los rangos inclusivos. Vale un arreglo de una línea (`end + 1`) la próxima vez que se
  abra ese componente. Registrado en `sdd/04-tasks.md`.

## Notas de ejecución

- El writer fue el único que escribió fuente (single-threaded). El orquestador mantuvo este doc, el
  `todo` y el ledger `sdd/`.
- El writer corrigió dos números del orquestador (20 casos de test existentes, no 18; 29 tokens con
  metacaracteres del catálogo con su derivación estricta, no 67 con la mía, que incluía nombres
  completos y sondas de operador). Ambos quedaron corregidos acá.
