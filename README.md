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
| Comparación entre almacenes / historial / alertas | ⏳ **modelado**, sin datos (1 tienda) |

## Stack

Vite + React 19 + **TypeScript (strict)** + Tailwind v4 + lucide-react +
react-router-dom v7. Tests con vitest; bike en worker (`src/workers/catalog.worker.ts`).

## Comandos

```sh
npm install
npm run dev          # dev server
npm run build        # build a dist/
npm run preview      # sirve el build
npm test             # vitest (lógica pura)
npm run typecheck    # tsc --noEmit (strict)
npm run acceptance   # Playwright contra preview (16 criterios AC/FR/WU)
```

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

- Node ≥ 23.6 para correr los scripts CLI como `.ts` (type stripping).
- `tsconfig` con `strict`, `verbatimModuleSyntax`, `allowImportingTsExtensions`
  (los scripts usan imports `.ts` explícitos para el type stripping).
- El worker sigue siendo dueño del catálogo; el main thread solo guarda `facets`.