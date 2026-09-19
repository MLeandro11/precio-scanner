# Lupa — Buscador de precios de almacén

Rebrand de **precio-scanner**: búsqueda de productos de almacén con el objetivo de
**armar una lista de compras** y, en el futuro, **vigilar precios por código EAN**.

> Una nota de identidad: la app se apoya en el **EAN** como identidad estable del
> producto (el mismo código en todos los almacenes). Hoy el catálogo es de **una
> sola tienda**; el modelo ya contempla multi-almacén, historial y alertas (sin
> simular datos que no existen).

## Flujo / rutas

```
Home (/) ──▶ /buscar (resultados, por nombre o EAN)
  │            │
  ├──▶ /escanear (escaneo por cámara ZXing + EAN manual)
  ├──▶ /producto/:ean (detalle + "agregar a lista")
  ├──▶ /historial/:ean (pendiente de datos de histórico)
  ├──▶ /lista (la lista, con vista de códigos de barras)
  ├──▶ /alertas y /perfil (placeholders honestos)
```

Navegación inferior: **Inicio · Alertas · [Escanear] · Lista · Perfil** (bar flotante outline).

## Estado por feature

| Feature | Estado |
|---|---|
| Búsqueda por nombre (fuzzy, worker + Fuse) | ✅ |
| Búsqueda exacta por código de barras/EAN | ✅ (FR-2.8) |
| Lista de compras (por EAN, cantidades, persistencia localStorage) | ✅ |
| Detalle de producto + agregar a lista | ✅ |
| Vista "códigos de barras" en la lista | ✅ |
| Escaneo con cámara (ZXing, cualquier dispositivo) | ✅ |
| Dark mode (sigue al sistema + toggle manual en Perfil) | ✅ |
| Comparación entre almacenes / historial / alertas | ⏳ **modelado**, sin datos (1 tienda) |

## Stack

Vite + React 19 + **TypeScript (strict)** + Tailwind v4 + lucide-react + react-router-dom v7 +
**sonner** (toasts) + **firebase** (auth, opcional y cargado por demanda). Tests con vitest;
búsqueda en worker (`src/workers/catalog.worker.ts`).

## Comandos

```sh
npm install
npm run dev          # dev server
npm run build        # build a dist/ (dispara postbuild: copia index.html → 404.html)
npm run preview      # sirve el build (ojo: vite preview TIENE SPA fallback y GH Pages no)
npm test             # vitest (lógica pura)
npm run typecheck    # tsc --noEmit (strict)
npm run acceptance   # Playwright; auto-sirve dist/ con semántica GH Pages (31 filas)
```

## Login (Firebase Auth) — opcional

La app funciona sin esto. Sin configurar, `/perfil` dice que no hay Firebase y **el SDK no se
carga**.

Se usa **Firebase Auth** y solo **Google** como proveedor. Firebase no es un backend que
mantengas vos: es uno gestionado, y hace el canje OAuth en su infraestructura, así que no hay
servidor propio.

> **Nota de decisión.** El motivo original para elegir Firebase era GitHub: su `client_secret`
es obligatorio en el canje de código, así que sin algo del lado servidor no se puede ofrecer.
Firebase lo resolvía dejando el secreto en su consola. **GitHub se descartó**, así que ese
argumento ya no aplica y queda una alternativa que no se puede ignorar si algún día molesta el
tamaño del SDK: **Google Identity Services** hace Google solo con **cero dependencias y ~0 KB**,
a cambio de que la gestión de sesión, expiración y persistencia pasa a ser tuya. Firebase se
mantiene porque ya está funcionando y resuelve esa parte; el SDK es lazy, así que no toca el
primer load ni la búsqueda.

Configuración (una vez, en la consola de Firebase):

1. Crear el proyecto y una Web App; copiar `apiKey`, `authDomain`, `projectId` y `appId`.
2. Authentication → Sign-in method → habilitar **Google**.
3. Authentication → Settings → Authorized domains → agregar `localhost` y
   `mleandro11.github.io`.

Y en el entorno (`.env`, gitignoreado) o como secrets del build:

```sh
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
```

Ninguno es secreto: el `apiKey` de Firebase identifica el proyecto, no autoriza nada por sí
solo. Lo que restringe quién entra es la configuración de proveedores y la lista de dominios
autorizados.

Notas de implementación:

- El SDK (`firebase/auth`, ~34 KB gzip medidos) se **carga por demanda**, solo al abrir
  `/perfil` — el mismo criterio con el que `ScanPage` se lazy-loadea. No pesa en el arranque
  ni en la búsqueda.
- Sin config, `readFirebaseConfig()` devuelve `null` y todo degrada a un mensaje. Es el caso
  normal en CI y en `scripts/acceptance.ts`, así que **no puede romper el build**.
- `auth/operation-not-allowed` y `auth/unauthorized-domain` son los dos errores que aparecen
  primero al configurar; los mensajes de la app los nombran explícitamente.
- Esto **identifica** usuarios. No protege archivos ni sincroniza nada: el catálogo sigue
  público y la lista sigue en `localStorage`.

## Pipeline de datos (con una sola tienda)

```sh
npm run normalize      # raw-catalog.json → public/data/catalogo.json
npm run generate-index # → catalogo-index.json + catalogo-facets.json
```

El catálogo (gitignored) tiene ~20.3k productos; 98,8% con barcode. Cada producto:
`{ id, nombre, marca, categoria, barcode, precio }`.

## Estructura relevante

```
src/
├─ App.tsx              # boot del catálogo (worker) + rutas (CatalogContext)
├─ layout/AppLayout.tsx # nav inferior outline
├─ pages/               # Home, Search, Scan, Product, History, List, Placeholder
├─ hooks/               # useSearch, useFavorites, useRecents, useList, useResolveEans
├─ lib/
│  ├─ types.ts          # Producto, Catalog, Facets, QueryParams/Result, worker msg
│  ├─ lupa/list.ts      # modelo de lista (ListaItem, AlmacenPrecio, HistorialPrecio) + lógica pura
│  ├─ searchEngine.ts   # cerebro del worker (fuzzy + barcode exacto)
│  └─ catalogLoader.ts  # carga con Cache API versionado
└─ workers/catalog.worker.ts
```

## Notas técnicas

- Node ≥ 23.6 para correr los scripts CLI como `.ts` (type stripping). Está declarado en
  `package.json` (`engines`) y el workflow de deploy usa Node 24.
- **GH Pages no tiene SPA fallback**: `postbuild` copia `dist/index.html` a `dist/404.html`
  después del build. Gracias a eso un deep link o un reload en una subruta (`/buscar`,
  `/lista`, `/producto/:ean`) sirve el shell de la app en vez de la página 404 de GitHub. La
  respuesta sigue siendo HTTP 404 (Pages no tiene rewrites), pero la app arranca y el router
  resuelve la ruta. Antes de esto, cualquier reload en una subruta rompía.
- `tsconfig` con `strict`, `verbatimModuleSyntax`, `allowImportingTsExtensions`
  (los scripts usan imports `.ts` explícitos para el type stripping).
- El worker sigue siendo dueño del catálogo; el main thread solo guarda `facets`.