# Feature: copiar el EAN de los productos de una lista

**Status:** done · **Started:** 2026-09-29 · **Commit:** `417dbe6`
**Branch:** `main` (el repo commitea sobre `main`; no se creó feature branch)

## Goal

Que el usuario pueda copiar al portapapeles el código EAN de cada producto, en las dos
superficies donde hay productos de una lista: la lista de trabajo (`/lista`) y el detalle de una
lista guardada (`/guardadas/:listId`). Además, una acción "Copiar todos" que copia el conjunto de
EAN de la lista en una sola operación.

## Authorized decision (user, 2026-09-29)

- Superficies: **detalle de lista guardada + lista de trabajo**. El índice `/guardadas` queda fuera.
- **Sí** a "Copiar todos", además del copiado por producto.

## Decisions taken by the orchestrator (reversible; correctable by the user)

- **D1 — El EAN es el control de copia.** En vez de sumar un botón nuevo al costado del EAN (que a
  320px de ancho no entra sin recortar el nombre y el stepper), el propio texto del EAN pasa a ser
  el `<button>`: full-width dentro de la columna de contenido, `min-h-11`, con el código en
  `font-mono` truncado y un icono `Copy` al final. Un solo idioma visual en ambas superficies y un
  target de 44px sin agregar ancho.
- **D2 — Formato del bulk.** `formatEanLines` une los EAN con `\n`: **un EAN por línea**, en el
  orden de la lista, sin nombres, sin encabezado, saltando entradas vacías. Es lo que se pega en
  una planilla o en otro sistema. Si el usuario quiere CSV, se cambia acá.
- **D3 — Confirmación honesta.** Éxito: `toast('EAN copiado', { description: ean })` y
  `toast('EAN copiados', { description: '<n> códigos' })` para el bulk. Fallo:
  `toast.error('No se pudo copiar', { description: 'Tu navegador no dio acceso al portapapeles.' })`.
  Nunca se afirma que copió si `copyText` devolvió `false` (principio del proyecto: estados
  honestos, FR-12.9 / FR-11.4).
- **D4 — `copyText` nunca tira.** `navigator.clipboard.writeText` cuando existe; fallback a
  `<textarea>` oculto + `document.execCommand('copy')`; `false` cuando no hay ningún mecanismo
  disponible o todo falló.
- **D5 — Ubicación de "Copiar todos".** `/lista`: dentro de la tarjeta de totales, que ya aparece
  solo cuando hay ítems. `/guardadas/:id`: en la fila del conteo ("N productos · fecha"), a la
  derecha. Sin botón cuando la lista está vacía, sin excepción.
- **D6 — Sin `aria-pressed`.** Copiar no es un estado; el control no se "activa". El `aria-label`
  lleva el EAN concreto (`Copiar el EAN 7793940219009`) y el toast es la confirmación.
- **D7 — Docs.** `PRODUCT.md` gana una línea en "Capabilities and Constraints". Los artefactos
  `sdd/*` **no se tocan**: el flujo SDD no fue pedido.

## Allowed edit surfaces

- `src/lib/clipboard.ts` (nuevo), `src/lib/clipboard.test.ts` (nuevo)
- `src/components/CopyEanButton.tsx` (nuevo)
- `src/pages/ListPage.tsx`
- `src/pages/SavedListDetailPage.tsx`
- `scripts/acceptance.ts`
- `PRODUCT.md`

Este documento y el `todo` los mantiene el orquestador (parent-owned), no el writer.

Nada fuera de esto. `src/lib/lupa/list.ts`, `src/lib/firestoreLists.ts` y el modelo de datos no
cambian: el EAN ya está en el ítem.

## Tasks

- [x] **T1** — `src/lib/clipboard.ts` + `clipboard.test.ts`: `formatEanLines` (pura) y `copyText`
      (nunca tira, con fallback). 9 casos con `vi.stubGlobal` (el runner corre en Node, sin DOM).
- [x] **T2** — `src/components/CopyEanButton.tsx`: control compartido según D1/D3/D6.
- [x] **T3** — `/lista`: EAN copiable en cada fila + "Copiar todos" en la tarjeta de totales.
- [x] **T4** — `/guardadas/:listId`: EAN copiable en cada fila + "Copiar todos" en la fila del conteo.
- [x] **T5** — `scripts/acceptance.ts`: `TOUCH-lista-copiar`, `TOUCH-lista-copiar-todos`,
      `CLIPBOARD-lista` (permisos + toast + lectura best-effort con evidencia honesta).
- [x] **T6** — `PRODUCT.md`: la capacidad quedó como cláusula de la enumeración "Working today"
      en vez de un bullet nuevo; la enumeración es la lista de lo que funciona hoy.
- [x] **T7** — Verificación E2E (`npm run acceptance`): **51/51 PASS** (50 PASS + 1 INFO
      preexistente `FR-2.8d`), 0 FAIL. El árbol verificado resultó ser **byte a byte el del commit**
      (ver "Trazabilidad" abajo).
- [x] **T8** — Commit de la unidad de trabajo: **`417dbe6`**
      `feat(lists): copy the EAN of every product, one code per line` — 7 archivos, +396/−3
      (`src/lib/clipboard.ts`, `src/lib/clipboard.test.ts`, `src/components/CopyEanButton.tsx`,
      `src/pages/ListPage.tsx`, `src/pages/SavedListDetailPage.tsx`, `scripts/acceptance.ts`,
      `PRODUCT.md`). `main` pasó de `ahead 5` a `ahead 7` (incluye `5bdc341` de la sesión peer);
      **nada pusheado**.

## Incidente: escritor concurrente en el mismo árbol (2026-09-29 04:41)

Mientras esta feature se implementaba, **otra sesión Pi viva** (`01a0e556-…`; la mía es
`01a0eb74-…`, según `orchestrator_list` / `orchestrator_session_id`) escribió en el mismo working
tree, sin worktree aislado y sin autorización de paralelismo:

| Archivo | mtime | Autor |
| --- | --- | --- |
| `src/layout/AppLayout.tsx` | 04:40:58 | sesión peer (labels del nav 10px → 11px) |
| `docs/design-system.md` | 04:41:37 | sesión peer (re-tier del ramp tipográfico) |
| `DESIGN.md` | 04:41:53 | sesión peer (`caption` 11px, `badge` 9px, `empty-title` 15px) |
| `src/pages/HomePage.tsx` | 04:41:57 | sesión peer (copy honesto de "Alertas de precio") |
| `scripts/acceptance.ts` (hunk `SCAN-navfs`) | 04:41 | sesión peer (fila de font-size del nav) |
| resto de `scripts/acceptance.ts` | 04:50:52 | writer de esta feature (aditivo sobre lo ajeno) |

**Consecuencias verificadas**: el writer de esta feature escribió de forma aditiva sobre
`scripts/acceptance.ts` y **preservó** el hunk ajeno; no tocó ninguno de los otros cuatro archivos.
El árbol de trabajo mezcla dos cambios no commiteados. Un commit hoy barrería los archivos de la
otra sesión, y `npm run acceptance` corre sobre el árbol mezclado (atribución de fallos).

**Estado: RESUELTO.** La sesión peer **commiteó su propio trabajo** mientras esta sesión preparaba el
commit, como **`5bdc341`** `fix(ui): raise the bottom-nav labels to 11px and stop promising price
alerts` (5 archivos, +92/−12: `DESIGN.md`, `docs/design-system.md`, `scripts/acceptance.ts`,
`src/layout/AppLayout.tsx`, `src/pages/HomePage.tsx`). Verificado que **no barrió nada de esta
feature**: el commit de la peer contiene exactamente sus 5 archivos y ninguno de los míos.

Efecto colateral favorable: su commit se llevó el hunk `SCAN-navfs` a `HEAD`, así que el diff
restante de `scripts/acceptance.ts` quedó compuesto **solo** por las filas de esta feature, y la
unidad se pudo commitear completa y coherente. Esta fue la secuencia que evitó el commit roto: en
el momento de máxima ambigüedad, `acceptance.ts` tenía el hunk ajeno *staged* y el mío solo en el
worktree, de modo que un `git commit` sin pathspec habría commiteado `SCAN-navfs` **sin**
`AppLayout.tsx` (labels de 10px, fila en FAIL): un commit que no pasa su propio gate.

## Trazabilidad: la evidencia del E2E aplica al commit

El E2E corrió sobre el árbol de trabajo en el que convivían los dos cambios: los archivos de la
feature, los de la peer (contenido idéntico al que después se commiteó como `5bdc341`), y los dos
hunks de `scripts/acceptance.ts`. Después del commit, `git diff HEAD -- <las 7 rutas>` sale
**vacío**: el contenido commiteado es byte a byte el contenido del directory tree que pasó
`51/51 PASS`. La evidencia no es una inferencia sobre "cómo habría sido el árbol commiteado".

## Verification gates

## Verification gates

1. `npm run typecheck` — sin errores (writer, observado).
2. `npm run test` — **17 archivos / 187 tests**, verde; baseline 16/178, sin regresiones (writer, observado).
3. `npm run build` — build limpio, 7.18s; los strings nuevos están en `dist/assets/index-*.js` (writer, observado).
4. `npm run acceptance` — **51/51 PASS**, 0 FAIL, sobre el árbol mezclado (ver abajo).
5. Revisión a 320px — sin scroll horizontal y ningún control nuevo bajo 44px, **medido**:
   `Copiar el EAN … 126×44` (×2) y `Copiar todos los EAN 324×44`.

### Evidencia E2E observada (sesión `gentle-ai-verify`, read-only)

```
PASS  TOUCH-lista-copiar       per-item EAN copy controls (2): Copiar el EAN 7793940219 126×44, Copiar el EAN 7790895000 126×44
PASS  TOUCH-lista-copiar-todos "Copiar todos los EAN" button: 324×44
PASS  CLIPBOARD-lista          per-row copy — toast shown; clipboard "7793940219009" matches expected "7793940219009";
                               bulk copy — toast shown; clipboard "7793940219009\n7790895000016" matches expected "7793940219009\n7790895000016";
                               clipboard permission granted
PASS  TOUCH-lista-quitar       per-item Quitar buttons (2): 44×44, 44×44
```

La fila `CLIPBOARD-lista` cayó en la rama **readable** (imprime el valor real y la palabra
`matches`), no en la rama permisiva de "no se pudo leer": el formato de D2 (un EAN por línea) quedó
**observado**, no inferido. `TOUCH-lista-quitar` siguió midiendo exactamente 2 controles: el nuevo
`aria-label` no contamina su filtro.

### Costo medido y honesto: densidad de la fila en `/lista`

`TOUCH-lista-quitar` reporta `list-row height: 107px` contra la baseline de `73px`. La causa es D1:
un target de 44px reemplazó una línea de texto de 16px (con `alerta` presente: nombre 20 + control
44 + alerta 16 + padding 24 ≈ 107px). Es un costo real de ~34px por fila, no un defecto de
implementación, y es la contrapartida de aplicar el piso de 44px del sistema a una acción por
producto. Palancas si el usuario quiere recuperar densidad: (a) dejar el copiado por producto solo
en la vista "Códigos de barras" (donde la fila ya es alta), o (b) volver al EAN como texto y aceptar
un target más chico, lo que viola el piso de 44px y `TOUCH-lista-copiar`.

## Evidence

- Baseline: `npm run test` → 16 archivos, 178 tests, verde (2026-09-29).
