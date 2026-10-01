# Feature: test del ciclo de vida del wrapper de ZXing (`R3-ZXING-WRAPPER-TEARDOWN`)

**Status:** done (implementado y verificado; **sin commitear**) · **Started / closed:** 2026-10-01
**Branch:** `main`
**Origen:** advisory del review nativo, registrado en `sdd/04-tasks.md` (`src/hooks/useBarcodeScanner.ts:174`).

## Goal

Que exista una verificación que se ponga **roja** si el wrapper global de `console.warn` deja de
restaurarse. Hoy el advisory dice, con razón, que una regresión ahí haría que la app **descarte
todos los warnings en silencio** y ninguna verificación existente lo note: la fila de acceptance
`SCAN-zxing-noise` solo afirma que nada matcheó *mientras el loop estaba vivo*.

## Estado real del código (leído, no supuesto)

El hook **sí** restaura en los dos caminos:

- `src/hooks/useBarcodeScanner.ts:230` — el cleanup del efecto: `cancelled = true`,
  `restoreZxingWarn?.()`, `controls?.stop()`, `stream.getTracks().forEach(stop)`.
- `src/hooks/useBarcodeScanner.ts:198` — el catch de `start()`: restaura antes de mapear el error a
  `denied`/`error`, con el comentario que lo explica. (La instalación está en `:174`.)

Y el módulo (`src/lib/zxingWarning.ts`) ya tiene sus propios tests: restore idempotente y no
apilable. **Lo que falta no es el arreglo: es la aserción sobre el hook.** Un `useEffect` que
olvide una de las dos llamadas no rompe ningún test.

## La barrera real: no hay entorno DOM

Los 18 archivos de test corren en **Node** (`vitest`, sin `environment`). No hay `jsdom`,
`happy-dom` ni `@testing-library`. El ciclo de vida del wrapper vive dentro del hook, así que no se
puede ejercitar sin un renderer y un DOM.

**Decisión del usuario (2026-10-01): agregar `jsdom` como devDependency** y testear el hook,
scoped al archivo nuevo con `// @vitest-environment jsdom` para que los otros 18 sigan en Node.
Se monta con `react-dom/client` + `act` de React 19 (sin `@testing-library`), y se mockea
`@zxing/browser` y `getUserMedia`. Es la opción que corre en **CI** (`npm test` está en el job
`verify`), a diferencia de una fila de acceptance (acceptance no está en CI).

Alternativas descartadas: extraer el ciclo de vida a un módulo imperativo (cierra el hueco por
diseño pero refactoriza un hook cuyos quirks de Safari están resueltos y comentados a mano) y una
fila de acceptance sola (prueba el ciclo real pero no corre en CI).

## Qué tiene que afirmar el test

1. **Filtro activo mientras escanea**: con la cámara y el decoder mockeados, el warning exacto del
   upstream (`MultiFormatReader: non-ReaderException from reader:` + un `NotFoundException`) es
   **suprimido**, y cualquier otro mensaje **se reenvía**.
2. **Desmontar restaura**: `root.unmount()` deja `console.warn` idéntico al original, y la sonda
   vuelve a llegar.
3. **Cámara denegada restaura**: `getUserMedia` rechaza con `NotAllowedError` → `status === 'denied'`
   y `console.warn` restaurado.
4. **Fallo de decode restaura**: `decodeFromStream` rechaza → `status === 'error'` y `console.warn`
   restaurado.
5. **`retry()` no deja el filtro apilado**: tras un rechazo y un `retry()`, desmontar vuelve al
   original una sola vez (no dos wrappers).

## Allowed edit surfaces

- `package.json`, `package-lock.json` (solo agregar `jsdom` como devDependency)
- `src/hooks/useBarcodeScanner.test.ts` (nuevo)
- `src/hooks/useBarcodeScanner.ts` (solo si el test demuestra un hueco real)

`odd/` y `sdd/` los mantiene el orquestador. No se toca `src/lib/zxingWarning.ts` ni su test:
el módulo ya está cubierto.

## Guardas contra el auto-engaño

- **No se debilita la aserción para que pase.** Si el test falla, se reporta el fallo y el
  diagnóstico; no se relaja la expectativa.
- Si aparece un hueco real en el hook, el writer lo arregla **en el mismo cambio** y lo reporta
  explícitamente (qué camino fallaba y qué se cambió), en vez de esquivarlo.
- Trampas conocidas de `jsdom` que hay que resolver, no rodear: `HTMLMediaElement.prototype.play`
  (no implementado), `video.srcObject` (puede no tener setter), `navigator.mediaDevices` (no
  existe; hay que definirlo y limpiarlo), y `BarcodeFormat` real del módulo (mockear solo
  `BrowserMultiFormatReader` con `importOriginal`).

## Tasks

- [x] **T1** — `jsdom@^29.1.1` como devDependency (37 entradas nuevas en el lockfile, **todas**
      `dev: true`; `dependencies` sin cambios). El archivo nuevo declara `// @vitest-environment jsdom`.
- [x] **T2** — `src/hooks/useBarcodeScanner.test.ts` con las 5 aserciones. 5 tests, verdes.
- [x] **T3** — `sdd/04-tasks.md` (advisory cerrado) y `sdd/03-design.md` (la estrategia de testing
      nombra el único archivo que corre en jsdom y por qué).
- [x] **T4** — Verificación (abajo).

## Verificación

Corrida por `gentle-ai-verify` (read-only), más la del orquestador:

- `npm run typecheck` limpio · `npm test` **19 archivos / 219 tests** (los 18 preexistentes siguen
  verdes) · `npm run build` ok · `npm run acceptance` **53/53 PASS**, con `SCAN-zxing-noise`,
  `SCAN-cam` y `SCAN-manual` verdes. Ninguna fila preexistente regresada.
- **Higiene de la dependencia**: el bundle quedó **byte a byte idéntico** al build del árbol
  anterior (mismo precache 17 entradas / 936,87 KiB, mismos hashes de chunk) y `grep -ril jsdom dist/`
  no devuelve nada. jsdom es dev-only e inalcanzable desde `dist/`. (El verificador encontró y
  corrigió una falsa alarma de +0,67 KiB que en realidad era el `.env` gitignoreado faltante en su
  build base, no jsdom.)
- **Valor de guarda probado por mutación, reproducido de forma independiente** en un sandbox en
  `/tmp` (el repo nunca se tocó): borrar el restore del catch (`:198`) pone **1 test en rojo** (el de
  fallo de decode); borrar el restore del cleanup (`:230`) pone **2 en rojo** (unmount y retry).
  Ninguna mutación sobrevive.
- **No vacuidad**: el spy **es** el `console.warn` original antes del mount (si no, el mensaje
  "unrelated warning" no podría llegarle), el chequeo de identidad discrimina (instalado ⇒
  `console.warn` es el wrapper, nunca el spy), y ningún `status` se usa como prueba de instalación.
  Sin fugas de stubs hacia los otros 18 archivos: aislamiento por archivo (`Isolate 19 workers`),
  un solo archivo con `@vitest-environment jsdom`, y `afterEach` completo. **20 corridas** (incluidas
  4 con `--sequence.shuffle`) sin un solo fallo.
- **Sin cambios en código de producción**: `git diff` de `src/hooks/useBarcodeScanner.ts` y
  `src/lib/zxingWarning.ts` vacío. El hook ya era correcto.

## Una precisión que hay que dejar escrita

El caso "cámara denegada" **no** cubre el restore del catch: `getUserMedia` rechaza en `:143`,
antes de que el wrapper se instale en `:174`, así que ese test solo prueba `status === 'denied'`.
El restore del catch lo ejercita necesariamente un fallo **posterior** a la instalación, es decir
solo el test de fallo de decode. No es una debilidad del test (es la naturaleza del invariante),
pero se escribe acá para que nadie lea la cobertura de más.
