# Feature: feed de cambios del catálogo en `/cambios` (`cambios-catalogo`)

**Status:** **T1–T10 hechos, verificados y revisados**; la feature está en producción y el feed se ve
**un día a la vez**. Las dos decisiones de producto que estaban abiertas (S6, S7) se resolvieron el
2026-10-15 (L11, L12), el stepper de días se agregó el 2026-10-21 (S9, L23) y ese mismo día cada
fila ganó su botón para agregar el producto a la lista (S10, L24). El header de este
documento había quedado congelado en el estado de la mañana del 2026-10-15 mientras el `## Log`
ya registraba el cierre de T2–T8: corregido el 2026-10-21 junto con la tabla.
**Started:** 2026-10-15 · **Closed:** 2026-10-21
**Branch:** `main` (convención del repo: se commitea sobre `main`, no se crea feature branch)
**Origen:** pedido del usuario en la sesión del 2026-10-09, retomado el 2026-10-15.

## Specs

- **S1.** La ruta `/alertas` pasa a `/cambios`; el tab del nav dice **`Cambios`** y el título de la
  pantalla **`Qué cambió`**. El icono deja de ser `Bell` (el usuario eligió el nombre del
  selector, no una frase suelta).
- **S2.** La pantalla es un **feed global de lo que se movió en el catálogo**: qué se agregó, qué
  subió y qué bajó de precio. **No es vigilancia personal**: no requiere que el usuario marque nada,
  y es la misma información para todos.
- **S3.** El diff lo calcula el **pipeline**, no el cliente: el cliente solo muestra lo que el
  pipeline publicó. (Descartado difear en el cliente: T9 borra a propósito las claves `?v=` viejas,
  así que no hay material contra el cual comparar.)
- **S4.** El artefacto de cambios se publica en el branch `datos` junto a los otros tres archivos, y
  el cliente lo baja con `fetch-data`.
- **S5.** **No se simula ningún dato.** Lo que la pantalla muestre tiene que estar en el artefacto
  publicado. Es el principio rector del repo, `sdd/02-spec.md` FR-8.4: *"nothing simulates data that
  does not exist."*
- **S6.** La ventana es **rodante de 7 días**. En cada corrida el artefacto se reconstruye como
  `[hoy] + los días anteriores del artefacto previo`, descartando lo que quede fuera de la ventana y
  reemplazando el día de hoy si ya estaba (idempotente por fecha, no por corrida). Quien abre la app
  cada tres días no pierde cambios.
- **S7.** Los cambios grandes (umbral `UMBRAL_GRANDE = 50` %) **entran tal cual, sin marca y sin
  filtro**. No se los anota como sospechosos y no se los esconde: un dato real no se desmiente ni se
  oculta. Ver L12, donde la decisión del usuario corrige la recomendación del orquestador.
- **S8.** Se elimina la afirmación falsa *"no tenemos historial de precios"* de **todos** los lugares
  donde vive. Aparecieron **9**, no 3: los dos del tramo del rename (`src/App.tsx:108` en el
  placeholder y `src/pages/HomePage.tsx:173` en la tarjeta de Home), `src/pages/HistoryPage.tsx:15`
  (+ el comentario de `:6-9`), `PRODUCT.md:77` y `PRODUCT.md:26-27` (la identidad del producto, la más
  punzante porque es exactamente lo que esta feature construye), `README.md:36`,
  `sdd/01-proposal.md:83-84`, `sdd/03-design.md:413` y `sdd/README.md:69-71`. Queda **una** mención
  deliberada: `sdd/04-tasks.md:526`, un registro con fecha del 2026-09-29 que no se reescribe.

- **S9.** El feed se ve **de a un día**: un header con flechas a los costados de la etiqueta del día
  (`<  día  >`). Pedido textual del usuario, 2026-10-21: *"quiero que tenga un header donde se pueda
  cambiar por dias, algo asi: <  hoy  >"*. Tres decisiones suyas, tomadas del selector ese mismo día:
  **(a)** el stepper **reemplaza** el listado apilado ("Un día a la vez"); **(b)** la etiqueta dice
  `Hoy`/`Ayer` **solo si es cierto**, y si no nombra la fecha ("Adaptativa"); **(c)** las flechas
  avanzan **un día de calendario** y un día sin entrada en el artefacto se muestra como tal
  ("Paso calendario, el hueco se muestra honesto").

- **S10.** Cada fila del feed **agrega su producto a la lista** sin salir de la pantalla. Pedido
  textual del usuario, 2026-10-21: *"ahora quiero en la misma pantalla poder agregar cada item a la
  lista"*. Tres decisiones suyas: **(a)** el botón **siempre suma 1** (si ya está, incrementa) y el
  toast lo dice; **(b)** las filas **sin EAN usable no llevan botón** — la lista se indexa por EAN, no
  hay con qué guardar el ítem; **(c)** el toast de confirmación ofrece **`Deshacer`**, que devuelve el
  estado exacto que el ítem tenía antes del toque.

## Contrato congelado del artefacto (diseño del orquestador, 2026-10-15)

**Nombre y ubicación**: `public/data/catalogo-cambios.json` — la convención del directorio es el
prefijo `catalogo-` (`catalogo.json`, `catalogo-index.json`, `catalogo-facets.json`). Escribirlo en
`public/data/` es todo lo que hace falta para que viaje al branch `datos` (H1).

**Esquema**:

```json
{
  "version": 1,
  "ventanaDias": 7,
  "generado": "2026-10-15T12:28:27Z",
  "dias": [
    {
      "fecha": "2026-10-15",
      "nuevos":   { "conteo": 13,  "truncado": false,
                    "valores": [ { "ean": "7798479600021", "nombre": "ALFAJOR DAMAS GRATIS 80G", "precio": 3450 } ] },
      "bajaron":  { "conteo": 20,  "truncado": false,
                    "valores": [ { "ean": "7798…", "nombre": "…", "antes": 1290, "ahora": 1150, "pct": -10.85 } ] },
      "subieron": { "conteo": 121, "truncado": false,
                    "valores": [ { "ean": null,    "nombre": "…", "antes": 240,  "ahora": 2900, "pct": 1108.33 } ] }
    }
  ]
}
```

**Reglas del contrato** — cada una existe por algo ya establecido en este repo:

1. **`conteo` exacto y lista acotada**: el idioma de `ListaAcotada` / `MAX_LISTA` de
   `scripts/catalog-diff.ts`. `CAP_DIA = 200` por lista y por día. Un día normal trae ~141 cambios y
   entra entero; una operación masiva de precios (el raw ya mostró una: `precioCambiado` marcó 1.091
   registros) no puede inflar el artefacto. `truncado: true` es lo que la UI tiene que decir en voz
   alta.
2. **`bajaron` y `subieron` son listas separadas**, no una sola con `pct` firmado: así un truncado
   nunca puede cortar la sección que más le sirve al usuario.
3. **`ean` puede ser `null`.** La identidad del producto en la app es el EAN y el barcode **no es
   confiable en las altas** (H5: un barcode de 11 dígitos y duplicados de nombre). La UI enlaza al
   detalle **solo** si el EAN resuelve (≥6 dígitos, el mismo corte que `SucursalesSection`), y
   **nunca** agrupa ni desduplica por nombre (R5).
4. **Hay que unir por `id`.** `compararCatalogos` **no emite `barcode`** en `CambioDePrecio`
   (`scripts/catalog-diff.ts:88-96`: solo `id`, `nombre`, `precioPrev`, `precioNext`, `pct`), así que
   el constructor del artefacto tiene que resolver el EAN contra el catálogo normalizado.
5. **`version: 1` es la puerta de salida**: un artefacto previo con otra `version` se descarta y la
   ventana arranca de nuevo, sin romper la corrida (R3).
6. **Nada del raw.** Se deriva de los catálogos **normalizados** (6 claves, cero `costo`/`margen`,
   H4). Está prohibido leer el raw para armarlo.
7. **El artefacto no es parte del boot.** Se carga **solo al abrir `/cambios`**, con la estrategia de
   `catalogo-facets.json` (network-first `cache: 'no-cache'` + la última copia como fallback
   offline), nunca con `?v=` (H3) y nunca sumado a las 3 descargas de arranque: así no se mueve el
   cálculo de la caché de 5,5 MB ni las filas de acceptance que ya existen.

**Orden de las filas en la UI (T5, actualizado por S9 el 2026-10-21)**: se muestra **un día a la vez**
(`92b0d5d`), abriendo en el más nuevo, y **dentro del día las bajadas primero** (`bajaron` →
`subieron` → `nuevos`). El header camina los días que el artefacto trae, un día de calendario por
toque, y **no da la vuelta** en los extremos: fuera de `[más viejo presente, más nuevo presente]` no
hay nada que este build pueda afirmar. La etiqueta del día es ley propia —`Hoy`/`Ayer` solo si el
calendario **local del lector** coincide; si no, la fecha— y un día dentro del rango sin entrada dice
*"No hay datos de este día"*, que es distinto de *"Sin cambios este día"* (día publicado sin
movimientos). La cabecera ya no resume la ventana: lleva el momento real de generación del artefacto.

### Refinamientos del contrato tal como quedó implementado (T2/T3, 2026-10-15)

Esto es lo que el cliente (T4/T5) puede dar por cierto **sin adivinar**:

- **Constantes exportadas** desde `scripts/catalog-changes.ts`: `CHANGES_VERSION = 1`,
  `WINDOW_DAYS = 7`, `CAP_DAY = 200`.
- **Builder puro**: `buildChangesArtifact({ previous, current, previousArtifact, generatedAt,
  windowDays? })` → `{ artifact, degraded }`. `previous` es `null` en una primera corrida.
- **`previousArtifact`** es `parseChangesArtifact(texto | null)` → `{ ok: true, artifact }` o
  `{ ok: false, reason }`, con `reason ∈ { absent, invalid-json, invalid-shape, version-mismatch }`.
  `degraded` repite ese `reason`, más `first-load` cuando no hubo `--baseline`.
- **`pct` se redondea a 2 decimales** (el ejemplo congelado muestra `-10.85` y `1108.33`).
- **`ean` es el string de solo dígitos que pasa `usableEan`** (≥6 dígitos — la **misma** función que
  la UI usa para decidir si hay foto), o `null`. Ojo: por eso un barcode de 11 dígitos **sí** cuenta
  como usable (H5); el corte es 6, no 13.
- **CLI de `refresh-catalog.ts`**: `--cambios-previos <path>` (default: hermano de `--baseline`; sin
  baseline, `public/data/catalogo-cambios.json`), y la **salida** es hermana de `--catalogo`
  (`public/data/catalogo-cambios.json` por default). `--json` sigue siendo **un solo objeto** en
  stdout (la prosa va a stderr).
- **`version` en el gate de `fetch-data`**: debe ser **exactamente `CHANGES_VERSION`**, no "un número".
  Un v2 en `datos` falla el guard de build con exit 2 en vez de llegar en silencio a la pantalla.
- **`fecha` y `generado`** salen del **mismo** origen que la fecha que ya viaja en `facets`
  (`raw.generada`), así no pueden discrepar. Si el raw no trae fecha, el CLI cae al reloj **y lo dice
  por stderr** — y en ese caso `facets` tampoco tiene fecha, así que la UI **no puede** inventar una.
- **Peso medido**: **15,6 KB** para un día real (20.797 productos, 154 filas). Con 7 días queda muy por
  debajo del techo de R4 (<1 MB).
- **Enlace al detalle**: en un día real, **151 de 154 filas tienen EAN usable**; las 3 sin EAN son el
  caso que la UI tiene que renderizar sin enlace y sin inventar uno.

## Tasks

| ID | Spec | Tarea | Ruta | Commit |
|----|------|-------|------|--------|
| **T1** | S1 | Rename de superficie a `Cambios` / `Qué cambió` / `/cambios` + matar las 2 promesas falsas de la pantalla | inline | `6509eb8` |
| **T2** | S2,S3,S5 | Pipeline: `refresh-catalog.ts` emite el artefacto de cambios en `public/data/` (módulo puro + tests) | | `3399ccc` |
| **T3** | S4 | `fetch-data.ts`: el 4º archivo en `ARCHIVOS`, **opcional al bajar el baseline** y **requerido en `--check`** (ver H2, es una trampa) | | `3399ccc` · gate `2b3025b` |
| **T4** | S2,S4 | Cliente: tipos + loader del artefacto, patrón `facets` (network-first + fallback offline), **nunca** `?v=` (ver H3) | | `6509eb8` · ley `85dead8` |
| **T5** | S2 | UI: la pantalla real en `/cambios`, reemplaza el `PlaceholderPage` | | `6509eb8` · `f0226e9` |
| **T6** | S1,S2 | Harness: filas de acceptance sobre el artefacto real (la pantalla renderiza, las secciones existen) | | `1dbb029` |
| **T7** | S5,S8 | Docs: `PRODUCT.md`, `README.md`, `DESIGN.md`, `sdd/` + la frase única de S8 | | `a637bda` · `d562dbb` · `fcc1b59` |
| **T8** | todas | Verificación independiente (`verify`): la feature toca la entrega (pipeline) y la caché del cliente | verify | sin commit propio: evidencia en L19 |
| **T9** | **S9** | Header de días en `/cambios`: un día a la vez, etiqueta honesta, huecos nombrados, fila nueva `CAMBIOS-day-nav` | inline | `92b0d5d` |
| **T10** | **S10** | Agregar a la lista desde la fila: `useList()` (la misma lista del detalle), botón 44×44 solo con EAN usable, toast con `Deshacer` que restaura el estado previo, fila nueva `CAMBIOS-add` | inline | `3abf9c8` |

**Cerrada el 2026-10-21.** Review nativo RDD `approved` con autoridad quemada (lineage
`review-1aee2dbb637b7e06`, tier high, 3 lentes) — el detalle y su límite real están en L19 y en la
observación de Engram `odd/cambios-catalogo/tasks`: el candidato revisado fue el **sufijo**
`873b645..HEAD`, porque un cambio de 3.500 líneas excede el presupuesto de contexto de la propia
herramienta; la cobertura del núcleo la dieron la verificación independiente y la corrida del
harness contra producción.

## Hallazgos que fijan el diseño (verificados, no supuestos)

- **H1 — El workflow publica el 4º archivo sin cambios.** `.github/workflows/actualizar-catalogo.yml`
  arma el branch con un glob: `DATA_FILES=("$GITHUB_WORKSPACE"/public/data/*.json)`, y por cada
  archivo hace `git hash-object -w` + `git update-index --add --cacheinfo`. Cualquier `*.json` que
  `refresh` escriba en `public/data/` viaja al branch `datos` por sí solo. **No hay que tocar el
  workflow** para publicar el artefacto.
- **H2 — La trampa de `fetch-data`.** `scripts/fetch-data.ts:50-54` tiene una lista explícita
  `ARCHIVOS` con los 3 nombres, y la validación exige que **todos** existan, no estén vacíos y sean
  JSON. Si el artefacto se agrega como requerido, **la primera corrida falla**: el tip de `datos`
  tiene solo 3 archivos y el artefacto todavía no existe. Tiene que ser **opcional al bajar el
  baseline** y **requerido en `--check`** (el guard de build, donde un doc sin artefacto sí debe
  fallar).
  - De regalo: `fetch-data --dest "$RUNNER_TEMP/baseline"` baja **todos** los `ARCHIVOS` al
    temporal, así que agregarlo ahí le da al pipeline **la fuente para acumular** (S6, ventana
    rodante) sin plomería nueva.
- **H3 — Dónde vive el artefacto en la caché del cliente.** `src/lib/catalogLoader.ts` tiene
  `CACHEABLE = ['catalogo.json', 'catalogo-index.json']` (los pesados) bajo claves `path?v=<version>`
  donde `version` es el sha256 de `catalogo.json`, y `catalogo-facets.json` con otra estrategia:
  network-first con `cache: 'no-cache'` + la última copia conocida como fallback offline. El
  artefacto de cambios es **chico**, así que va con el **patrón de facets**. Si se lo mete en el
  camino `?v=`, el prune de T9 lo borra y lo vuelve a bajar todos los días.
- **H4 — El artefacto no puede filtrar el dato de costo, por construcción.** Verificado sobre los
  20.797 productos del 2026-10-15: un producto normalizado tiene exactamente 6 claves —
  `barcode, categoria, id, marca, nombre, precio` — y **cero** `costo`/`margen`. Todo artefacto
  derivado de los catálogos normalizados hereda la regla de higiene del repo sin trabajo extra.
- **H5 — El diff diario, medido.** Medición real del 2026-10-14 → 2026-10-15 (detalle en Engram,
  `precio-scanner/diff-diario-medido`): **13 altas, 141 cambios de precio** (121 subieron, 20
  bajaron, 20.643 iguales), mediana **+5,4%**, máximo **+1.108%**, **4 cambios >50%**, 0 EANs
  desaparecidos, 0 categorías nuevas. El feed de un día son ~154 filas ⇒ un artefacto de un día es
  **chico**; uno de 30 días sigue siendo chico (≈4.600 filas).
- **H6 — El cron está vivo.** `origin/datos` tiene commits del 10-12, 10-13, 10-14 y 10-15, todos
  entre 12:30 y 16:30 UTC. El pipeline corre solo y nadie lo estaba mirando.

## Riesgos

- **R1 — Exposición.** El artefacto se publica en un branch público. Contiene nombre, precio,
  barcode e id de productos: exactamente los datos que el sitio ya sirve. No agrega exposición.
  Queda **prohibido** que el artefacto derive del raw (que sí trae `costo` y `margen`) — ver H4.
- **R2 — R7 expuesto al usuario.** Los ~4 cambios >50% por día pueden ser precios mal cargados en el
  POS. Publicarlos es ponerlos frente al usuario. **Depende de S7.**
- **R3 — Estado en el pipeline (la ventana acumula, S6).** Acumular obliga a leer la propia salida
  anterior. **Regla reconciliada el 2026-10-15 y escrita como quedó implementada** — quién grita en
  cada capa:
  - **AUSENTE** (o `--baseline` sin artefacto hermano): **degradar**. La ventana arranca de cero y el
    reporte lo dice en prosa (`cambios: ventana reiniciada`). **Nunca es fatal**: es el estado
    legítimo de la primera corrida.
  - **PRESENTE pero inutilizable** (no es JSON, vacío, forma inválida, o `version` que esta build no
    lee): **FATAL, exit 3**, y el artefacto previo **no se pisa**. Es el mismo criterio que el CLI ya
    aplicaba a un `--baseline` explícito ilegible (`refresh-catalog.test.ts`: *"an unreadable
    baseline (a directory) fails (exit 3) before anything is written"*). Degradar acá reiniciaría la
    ventana y **tiraría hasta 6 días de feed sin que nadie se entere**. **Borde corregido el
    2026-10-15, y lo encontró la verificación independiente, no un test**: un **directorio** o una
    **lectura denegada** en ese path caía en `absent` porque el helper se tragaba cualquier error de
    lectura en el mismo `null` que "no está"; ahora el CLI distingue *no está* de *no se puede leer*
    (`existsSync` + `try/catch`, exit 3 en los dos casos de falla) y el helper se borró junto con su
    comentario, que afirmaba lo contrario (*"Absent or unreadable is `null`, never a failure"*).
  - **La capa de red**: `fetch-data` corta con **exit 2** un artefacto presente que no es JSON o que
    no trae la `version` que esta build entiende; **solo tolera su ausencia** al bajar el baseline.
    En el workflow, exit 2 o exit 3 = el job falla y **abre un issue**: un artefacto roto es una
    falla de publicación y tiene que llegar a un humano, no degradarse.
  - **Dónde vive cada validación, a propósito**: la validación **profunda de la forma** está en
    `parseChangesArtifact` (una sola autoridad sobre la forma del artefacto, testeada aparte) y el
    gate de red se queda **barato** (JSON + versión). Un v1 con forma rota atraviesa el gate y muere
    en el CLI con exit 3.
  - **Corrección de esta regla**: su primera versión decía "un artefacto corrupto no debe romper la
    corrida". Era mal consejo: tolerar la corrupción no era resiliencia, era una **pérdida
    silenciosa** de hasta 6 días. Se implementó en consecuencia, con RED observado (1 failed | 23
    passed) antes del cambio.
- **R4 — Peso del artefacto.** El cliente ya cachea 5,5 MB. El artefacto tiene que quedarse chico
  (<1 MB); con la ventana de S6 se acota por construcción.
- **R5 — Nombres de producto como clave.** El feed muestra nombres, pero **la identidad es el EAN**
  (principio de identidad del repo). Las 13 altas del 15-10 incluyen duplicados de nombre con
  barcodes distintos y un barcode de 11 dígitos: el feed **no puede** agrupar ni desduplicar por
  nombre.
- **R6 — La secuencia de publicación importa (trampa de arranque).** Si `--check` (el guard de build)
  exige el artefacto desde el primer día, cualquier deploy que corra **entre** que aterrice T2 y la
  primera corrida que lo publique **falla**, y el sitio deja de actualizarse. Orden obligatorio:
  T2 aterriza → se dispara el workflow de datos a mano (`workflow_dispatch`) y se confirma que
  `catalogo-cambios.json` está en la punta de `datos` → recién ahí `--check` lo exige. La
  alternativa (dejarlo opcional para siempre) se descarta: un pipeline roto dejaría de publicar sin
  que nada avise.

## Allowed edit surfaces (de la feature)

`scripts/catalog-diff.ts`, `scripts/refresh-catalog.ts`, `scripts/fetch-data.ts`,
`src/lib/catalogLoader.ts`, `src/lib/types.ts`, `src/pages/CambiosPage.tsx` (nuevo),
`src/App.tsx`, `scripts/acceptance.ts`, `PRODUCT.md`, `README.md`, `DESIGN.md`, `sdd/`,
`src/pages/HistoryPage.tsx` (solo S8).

## Log

- **L1** (usuario, 2026-10-09 18:41, verbatim, origen de la feature):
  > si, pero espera. quiro hablar de posibles cosas para agregar. como por ejemplo, saber que
  > producto se agregaron nuevo o cambiaron de precios y que se vean en la pantalla de alertas.
  > despues otra cosa ...

- **L2** (usuario, 2026-10-15, verbatim): *"no, para ser sincero no me interesa mucho a que hora se
  actualiza, prefieron modificarlo mas tarde. sigamos charlando el punto 1"* ⇒ **R9 (el cron corre
  ~7 h tarde) queda explícitamente diferido por el usuario**: no es parte de esta feature.

- **L3** (usuario, 2026-10-15, verbatim): *"por lo que dice tu analisis, podriamos cambiar de
  \"alerta\" a un nombre mas adecuado como \"novedades\""* ⇒ propuso "Novedades"; el orquestador
  empujó "Cambios" con la medición de H5 (13 altas vs 141 cambios: "Novedades" describe el 8%).

- **L4** (decisión del usuario, 2026-10-15, del selector): **`Feed de novedades del catálogo`**
  ("Qué entró y qué cambió de precio. Global, sin suscribirte a nada.") ⇒ **S2 y S3**.

- **L5** (decisión del usuario, 2026-10-15, del selector): **tab `Cambios`** (preview: título de
  pantalla `Qué cambió`, `Datos del 15 de octubre`) ⇒ **S1**.

- **L6** (usuario, 2026-10-15, verbatim): *"arranquemos nomas, olvida lo de \"despues otra cosa...\""*
  ⇒ autoriza arrancar con el tramo chico; la "otra cosa" que iba a mencionar **se retira**.

- **L7** (usuario, 2026-10-15, verbatim): *"vamos con todo"* ⇒ autoriza la feature completa (no solo
  el rename). Antes de este mensaje el orquestador había cerrado T1 y dejado abiertas las
  decisiones S6 y S7.

- **L8** (evidencia, T1): `npm run typecheck` limpio · **RED observado**: con los 3 archivos de
  `src/` revertidos a mano (backup en `/tmp`, `git checkout --`), build + `npm run acceptance` =
  **53/55**, `FAILED: NAV-cambios, DEEP-cambios`, ninguna otra fila rota. **GREEN**: restaurado,
  **55/55**, con `Cambios -> /precio-scanner/cambios` y `hard GET /cambios -> screen rendered`.
  `npm test` = **493 passed / 34 archivos**. Diff: **10 archivos, +68 −23** (45 líneas son las 2
  filas nuevas del harness).

- **L9** (evidencia, T1, barrido final): quedan menciones a "Alertas" solo en registros con fecha,
  que **no se reescriben**: `sdd/04-tasks.md:526`, `.impeccable/critique/2026-09-28T02-16-17Z__….md`
  (líneas 84 y 141) y `odd/tasks/copy-ean.md:90`. Reescribir historia es peor que un string viejo.

- **L10** (lección del orquestador, 2026-10-15): **se grepó la superficie, no la afirmación.** Al
  buscar `alertas` (el string que se renombraba) no apareció la misma frase falsa en
  `HistoryPage.tsx` / `PRODUCT.md` / `README.md`, que no usan esa palabra. Se mataron 2 de 5
  instancias. **Regla: para eliminar una afirmación falsa, grepear la afirmación ("no tenemos",
  "sin datos", "todavía no existe"), no el nombre de la cosa.** De ahí sale **S8**.

- **L11** (decisión del usuario, 2026-10-15, del selector): **`Ventana rodante de 7 días`** ⇒ **S6**.

- **L12** (decisión del usuario, 2026-10-15, del selector): **`Entran tal cual, sin marca`** ⇒ **S7**.
  El orquestador venía recomendando marcarlos ("precio a verificar") y **la decisión del usuario
  está mejor fundada que esa recomendación**: la propia investigación de R7 (T12, cerrada el
  2026-10-07) concluyó que los cambios grandes son **correcciones reales hechas en el POS** y que los
  precios mal cargados eran los viejos. Marcar esa clase como sospechosa habría afirmado una duda que
  la evidencia del repo no sostiene — un defecto de honestidad disfrazado de prudencia. Sin marca y
  sin filtro: un dato real no se desmiente ni se esconde.

- **L13** (diseño del orquestador, 2026-10-15): **contrato del artefacto congelado** (ver la sección
  de arriba: nombre, esquema, 7 reglas, orden de filas). Es lo que desbloquea T2, T4 y T5 en
  paralelo: los tres escriben contra una interfaz fija y no se esperan entre sí.

- **L14** (evidencia, T2/T3, 2026-10-15): el writer tocó **exactamente las 6 superficies**
  permitidas (verificado con `git status`), `npm run typecheck` limpio y **35 archivos / 521 tests**
  (línea base **34/493** ⇒ +28). **Prueba con datos reales** (que el writer no podía hacer: no bajó
  el branch): corrí `buildChangesArtifact` sobre los dos catálogos normalizados reales del branch
  `datos` (10-14 → 10-15, 20.784 → 20.797 productos) y **cruzó exacto contra mi medición
  independiente**: 13 nuevos / 20 bajaron / 121 subieron = **141 cambios**. Idempotencia por fecha
  verificada (re-run del mismo día → **1 día**, `degraded: null`, sin duplicar), **15,6 KB**, y
  **151/154 filas con EAN usable**.

- **L15** (evidencia, cierre de T3, 2026-10-15): encontrado por el orquestador y arreglado
  test-first: `--check` exigía **un `version` numérico**, no **el que esta build entiende**, así que un
  artefacto v2 de `datos` habría pasado el guard de build y el rechazo quedaba librado al cliente, en
  silencio. **RED**: `1 failed | 30 passed` (el caso `version: 2` no levantaba error) → código
  comparando contra `CHANGES_VERSION` → **31/31**, más los dos textos de `fetch-data.ts` que decían
  "version numérico". Suite completa en verde: **35 archivos / 521 tests**.

- **L16** (evidencia y corrección de R3, 2026-10-15): la primera versión de R3 pedía degradar ante un
  artefacto corrupto; **implementado, era peor consejo** — perdía hasta 6 días de ventana en
  silencio. Regla final: **ausente degrada, presente-inutilizable es fatal (exit 3)**. **RED
  observado** en el test reescrito (`1 failed | 23 passed`: hoy sale con 0 y pisa el artefacto) →
  implementado en `scripts/refresh-catalog.ts` → **24/24** en el archivo.

- **L17** (cierre documental de T7, 2026-10-15): los docs que enumeraban `/cambios` como placeholder
  quedaron verdaderos: `PRODUCT.md` (una frase que el propio orquestador había escrito **hoy** y ya
  era falsa), `README.md` (el árbol de rutas y la tabla de features, con una fila nueva para el feed),
  `sdd/01-proposal.md`, `sdd/02-spec.md` (FR-6.2) y `sdd/03-design.md`. **Lección repetida**: el
  primer grep fue **por línea** y se perdió `sdd/01` y `sdd/02`, donde la palabra "placeholders" cae en
  la línea anterior a `cambios`; hubo que grepear **con contexto**. **Decisión editorial diferida al
  usuario**: el feed **no** tiene un `FR` numerado en `sdd/02-spec.md` — agregarlo es una decisión
  sobre el conjunto SDD, no del implementador, así que la ruta quedó descrita en prosa y sin número
  inventado.

- **L18** (evidencia de T6, 2026-10-15): el harness ganó 4 filas, y las corridas enseñaron dónde
  estaba el error **del orquestador, no de la app**. **RED** (artefacto fuera de `dist/`): **56/59**,
  con `CAMBIOS-screen`/`-sections`/`-rows` en FAIL y `CAMBIOS-absent` en PASS — las filas no son
  vacuas, y la pantalla sin dato dice *"Todavía no hay cambios publicados. El catálogo se actualiza
  solo, todos los días."* **GREEN parcial**: `CAMBIOS-sections` en verde con **los números reales**
  (`bajaron=20, subieron=121, nuevos=13`, leídos del artefacto servido) y `CAMBIOS-rows` fallando con
  151 enlaces que estaban **bien**: el regex estaba anclado en `^/producto/` y la app se sirve bajo el
  base path **`/precio-scanner/`**. Corregido a la ruta resuelta (`new URL(a.href).pathname`) →
  `154/154` filas, `151` con enlace, `3` sin enlace = `3` sin EAN, **0 malformados**. Y la corrida
  siguiente dejó la carrera al desnudo: `CAMBIOS-screen` leyó `data-changes-state` cuando el
  contenedor **ya estaba visible pero todavía decía `loading`**. Arreglado esperando a que el estado
  **asiente** (`waitForFunction`, el mismo idioma que las filas de búsqueda) en vez de leer el
  atributo apenas aparece.

- **L19** (verificación independiente, T8, 2026-10-15): delegada a `gentle-ai-verify` con mandato de
  **falsificación** y 12 propiedades numeradas. Baseline propio, medido por el verificador:
  typecheck limpio, **37 archivos / 559 tests**, **59/59 de acceptance**. **Sostuvo, con sondas
  propias**: la ventana (borde exacto, descarte del día viejo y del futuro, reemplazo del mismo día
  e idempotencia byte a byte), el cap con `conteo` exacto incluso con 1000 entradas, las listas
  separadas y el orden del DOM, las reglas del EAN (unión contra el catálogo **vigente**, `null`
  para 5 dígitos y para cadena vacía, cero EAN inválidos entre los 154 reales, y ningún agrupamiento
  por nombre), **la no-fuga de `costo`/`margen` probada inyectando un input sucio**, el gate exacto
  de `version`, los cinco estados del loader (incluido HTML-200 → `absent`), que el artefacto **no**
  entra al boot ni lleva `?v=` (corrió el prune real y confirmó que la clave sin versión sobrevive),
  la honestidad de **todos** los estados, y **H1** replicando el loop del glob del workflow (4
  archivos en el tree). **8 mutaciones** probaron que los tests nuevos pueden fallar.

  **Y rompió tres cosas.** (1) **R3 tenía un agujero en su propio borde** (ver R3): un directorio o
  una lectura denegada daba `absent` y exit 0, perdiendo hasta 6 días de ventana en silencio —
  mientras que `--baseline` con un directorio **sí** falla, o sea las capas se contradecían entre sí.
  **Corregido con RED observado** (`1 failed | 24 passed`) → focal **25/25** y suite **37/560**.
  (2) **`--check` es inerte**: no lo llama ningún workflow, y `deploy.yml` baja los datos en modo
  descarga (artefacto opcional), así que una punta de `datos` sin artefacto publica un sitio que dice
  "Todavía no hay cambios publicados" para siempre sin que nada avise. **Queda como decisión del
  usuario**: cambia la entrega y arrastra la secuencia de R6. (3) **S8 seguía incompleto**: la misma
  afirmación falsa vivía en `sdd/01-proposal.md:83-84` y `sdd/README.md:69-71` (7ª y 8ª instancia).
  El verificador las llamó notas con fecha y **discrepé** tras leerlas: la primera es la lista de
  no-goals viva y la segunda la sección *Open work*. Corregidas.

  **Advisories ACEPTADOS sin arreglar, con su razón** (ninguno es alcanzable desde la salida normal
  del pipeline): (a) `isValidList` valida los días acarreados de forma laxa (`conteo` cualquier número
  finito, `valores` cualquier objeto), así que un artefacto previo **editado a mano** con `conteo: 5,
  valores: []` se acarrearía y se mostraría "En total: 5" con 0 filas; (b) `formatPct` redondea a 2
  decimales, así que un cambio real mínimo muestra `0 %` con flecha (alcanzable con un cambio de 1
  peso en un producto caro). Se registran en vez de arreglarse para no seguir agrandando el cambio.

  **El verificador no pudo probar** que las 4 filas nuevas de acceptance van a RED (se autoimpuso una
  sola corrida), pero esa evidencia existe en el padre: la corrida sin el artefacto dio **56/59**, con
  `CAMBIOS-screen`, `CAMBIOS-sections` y `CAMBIOS-rows` en FAIL y `CAMBIOS-absent` en PASS.

- **L20** (cierre de S8, 2026-10-15): el barrido por la **afirmación** (esta vez con contexto y
  incluyendo `sdd/README.md`, que nunca se había grepeado) dio **una novena instancia** que ningún
  grep anterior había visto, porque el archivo usa otras palabras: `PRODUCT.md:26-27` afirmaba que la
  identidad del producto —*"seguir si un precio cambió"*— "currently has no data behind it". Es
  exactamente lo que esta feature construye, así que además de falsa era la más incómoda. Corregida.
  De las once coincidencias que quedan en los docs, **diez son ciertas**: hablan de **alertas** o de
  **comparación multi-almacén** (que siguen sin datos) o son principios de diseño, no afirmaciones
  sobre el historial. Observación para más adelante, sin cambiar: `PRODUCT.md:22` fija "~20,331 items"
  y el catálogo ya va por 20.797 — es la misma clase de conteo vivo que T11 des-hardcodeó del harness;
  toca decidir si un número que deriva cada día debe vivir en la prosa del producto.

- **L21** (cierre de los advisories, 2026-10-15): los dos advisories que la verificación dejó
  abiertos quedaron cerrados **con RED observado**, y el primero obligó a corregir la ley del propio
  orquestador.

  (a) **Conteo que no cerraba con las filas.** Los dos parsers ahora exigen la propiedad de
  honestidad —`valores.length <= conteo` y `truncado ⟺ hay menos filas que el conteo`—, que es la que
  impide que la pantalla imprima "En total: N" por encima de menos filas. **RED**: 2 failed |
  32 passed. La primera versión de la ley era la salida exacta del builder
  (`valores.length === min(conteo, CAP_DAY)`), y **la suite completa la refutó**: atar la validez al
  cap actual hace que el día que el cap cambie **todo artefacto ya publicado quede
  presente-pero-inutilizable** — o sea exit 3 en cada corrida y un issue por día, para siempre, hasta
  que alguien borre el branch a mano. La ley débil **no afloja la cobertura**: sigue rechazando los
  mismos dos casos mentirosos, que también fallan con ella. El cap queda como asunto del builder.
  Los dos parsers aplican la misma ley **a propósito**, y el del cliente no conoce `CAP_DAY`:
  importarlo del pipeline sería la misma deriva que se acaba de arreglar con `CACHE_NAME`.
  Tres fixtures existentes declaraban conteo sin filas y `truncado: false`; se corrigieron a
  `truncado: true`. Estaban mal: no era un caso legítimo que la ley estuviera rechazando.

  (b) **`"0 %"` con flecha.** `formatPct` devuelve `<0,01 %` cuando el movimiento es real pero
  redondea a cero a dos decimales (el borde del propio formateador), porque la flecha ya dice la
  dirección y un `0 %` afirmaría que no pasó nada. **RED**: 1 failed | 23 passed, revirtiendo **solo**
  esa función y restaurándola byte a byte (`cmp`).

  **Verificación**: typecheck limpio · focales **58/58** · suite **37 archivos / 564 tests** (eran 560).

- **L22** (docs del tramo, 2026-10-15): `PRODUCT.md:22` dejó de fijar un conteo viejo (decía ~20.331
  items y 98,8% cuando la punta real tiene **20.797 y 98,7%**) y ahora lleva el número **medido y
  fechado** (2026-10-15), que es el idioma que este repo usa para un dato que deriva (como el
  "verified 2026-02" de `images.ts`). Y `sdd/02` ganó **FR-6.5**, que especifica el feed con sus leyes
  visibles: orden congelado, conteo exacto y aviso de truncado, enlace solo con EAN usable, y estado
  ausente que dice la verdad. Con eso **se deja de diferir la decisión editorial**: el feed ya tiene
  número de requisito, y salió de la sección de rutas (FR-6) en vez de inventar una sección nueva.

- **L23** (usuario, 2026-10-21, verbatim, abre **S9**): *"despues. quiero modificar las pantalla de
  cambios. quiero que tenga un header donde se pueda cambiar por dias, algo asi: < hoy > me
  entiendes?"* — el "despues" es la respuesta a la corrección del header de este documento, que
  quedó **pendiente a propósito** hasta este tramo. Después, del selector: *"Un día a la vez
  (reemplaza el listado)"* · *"Adaptativa: hoy/ayer solo si es cierto"* · *"Paso calendario, el
  hueco se muestra honesto"*. Y *"sisi"* al final autoriza commitear y cerrar el ledger.

  **Antes de diseñar se midió el artefacto que sirve producción**, y ese dato cambió el diseño:
  `generado: 2026-10-20T12:32:55Z`, 6 días (10-15..10-20), y **a la 01:04 del 21**. O sea: un header
  que diga "hoy" sobre el día más nuevo **estaba mintiendo en ese mismo momento**. El cron corre
  12:30–16:30 UTC, así que la etiqueta tiene que sobrevivir a las dos situaciones, y por eso `Hoy`
  y `Ayer` se imprimen solo cuando el calendario **local del lector** coincide (la `fecha` del
  artefacto es el día UTC de `utcDay(generatedAt)`; "hoy" es una palabra sobre quien mira, no sobre
  el bucket del archivo).

  **Tres correcciones al diseño del orquestador, todas decididas por evidencia**:
  (a) **wording del hueco**: el preview decía *"No hubo actualización este día"* y se implementó
  *"No hay datos de este día"* — la ausencia puede ser que no corrió, que la corrida falló antes de
  publicar, o que la ventana arrancó después, así que afirmar "no hubo actualización" es una claim
  sobre el pipeline que el archivo no sostiene (misma ley que L10/L12);
  (b) **rango** = `[día más viejo presente, más nuevo presente]`, no `nuevo − ventanaDias + 1`:
  fuera de lo presente no sabemos nada, y un reset de ventana borra días que sí se corrieron;
  (c) **línea de última actualización** en lugar de la línea de ventana: con un día a la vez la
  pregunta que queda es "¿de cuándo es esto?", y un `generado` ilegible lo **dice** en vez de callarse
  (el silencio se lee como "no hay edad que mostrar").

  **Evidencia**: **RED observado** (14 failed | 21 passed; los 21 son estados, secciones y filas, que
  siguen verdes sin cambios) → focales **35/35** · suite **575 tests / 37 archivos** (eran 564) ·
  `typecheck` limpio · **acceptance 60/60** con la fila nueva `CAMBIOS-day-nav` caminando los 6 días
  reales en ambas direcciones (`2026-10-20[77] → 19[42] → 18[85] → 17[152] → 16[2] → 15[97]`, vuelta
  al 20, extremos deshabilitados) · pantalla verificada por screenshot a 390×844.

  **Dos defectos que encontró la verificación, no el diseño**: `toLocaleString('es-AR')` con
  `hour`/`minute` usa 12 h, así que la línea salía `12:28 p. m..` con doble punto (arreglado con
  `hour12: false`); y la primera versión de la fila del harness **exigía más de un día** y se ponía
  roja contra el artefacto local de un solo día **mientras la app hacía lo correcto** — una fila no
  puede fallar por la forma del dato que sirve, así que ahora deriva la ruta del archivo servido y el
  caso de un día se asserta como "los dos extremos son el mismo día".

  **Un falso positivo, medido y descartado**: el screenshot a 2x hacía ver los chevrons invisibles;
  `getComputedStyle` dio `rgb(15, 23, 42)`, opacity 1, svg 18×18, botón 44×44, y a 3x se ven nítidos.
  Era el reescalado de la imagen. **No se arregla un problema que no se midió.**

- **L24** (usuario, 2026-10-21, verbatim, abre **S10**): *"ahora quiero en la misma pantalla poder
  agregar cada item a la lista"*. Del selector, tres decisiones suyas: *"Un + por fila que siempre
  suma 1"* · *"Sin botón (3 de las 154 filas reales)"* para las filas sin EAN usable · *"Sí, toast con
  Deshacer"*.

  **Primero se leyó cómo funciona la lista hoy, en vez de inventar una**: `useList()` es **la** lista
  de compras (`localStorage`, `precio-scanner:lupa:lista`) y es la misma que escribe el detalle del
  producto; las "listas guardadas" son snapshots opcionales de esa lista en Firestore. O sea que
  agregar desde el feed **no** es una operación nueva: es la misma, y por eso el badge del nav
  (`AppLayout`, layout route que nunca se desmonta) tiene que seguirla sin recargar.

  **El costo real de la decisión, dicho antes de aceptarla**: el botón de 44×44px (la ley de touch
  del repo) se come **~50px de ancho del nombre** — las filas truncan antes — y agrega **un stop de
  tab por fila**; en el día más pesado del artefacto real (152 filas) eso son 304 stops de teclado.
  Queda así porque el borde hace descubrible la acción y el target chico sería peor; queda anotado
  como el punto a revisar si molesta. **Nada de esto se descubrió después de commitear: se midió en
  el screenshot antes.**

  **Detalle de implementación que no es cosmético**: el botón es **hermano** del `<a>`, nunca hijo
  (`<button>` dentro de `<a>` es HTML inválido y vuelve impredecible el tap target), y su
  `aria-label` lleva el nombre del producto porque "agregar" repetido 77 veces no identifica nada en
  un lector de pantalla. El `Deshacer` restaura el estado **exacto** previo al toque: saca el ítem si
  era nuevo, y repone la cantidad anterior si era un incremento — un "Deshacer" que se queda con el
  ítem es un segundo cambio que nadie reportó.

  **Evidencia**: **RED observado** (6 failed | 35 passed) → focales **41/41** · suite **581 tests /
  37 archivos** (eran 575) · `typecheck` limpio · **acceptance 61/61**, con `CAMBIOS-add` haciendo el
  viaje completo en el bundle real: lista `2 → 3` con el EAN presente, badge del nav en `"3"`
  **sin recargar**, `Deshacer` → lista de vuelta en `2`.

  **Lección de harness repetida en el mismo día**: la fila mide **relativo a lo que encuentra** y no
  asume lista vacía. Cuando corrió, la lista ya tenía 2 ítems que habían dejado las filas de
  `LIST-badge`; una fila que asumiera cero se habría puesto roja sobre código correcto — exactamente
  el defecto que ya había aparecido con el artefacto de un solo día en `CAMBIOS-day-nav`.
