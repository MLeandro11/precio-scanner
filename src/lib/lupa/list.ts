/**
 * Lupa list model — pure list math for the shopping list (no React, no storage).
 *
 * The list is the heart of Lupa: products are identified by their **EAN**
 * (stable identity), each entry carries a quantity and an optional price alert.
 * Distinct `AlmacenPrecio`/`HistorialPrecio` models exist so multi-store price
 * comparison and history can be wired later without a shape change; Lupa today
 * runs against a single store, so nothing here simulates that data.
 */
export interface ListaItem {
  /** EAN/código de barras normalizado (identidad estable del producto). */
  ean: string
  cantidad: number
  /** Alerta de precio habilitada para este ítem (el aviso real llega con datos). */
  alerta: boolean
  /** Nombre visto la última vez (para mostrar sin ir al catálogo). */
  nombre?: string
  /** Id del producto en el catálogo actual, si fue resuelto. */
  productoId?: string
}

/** Precio de un EAN en una tienda (modelo futuro, hoy hay una sola tienda). */
export interface AlmacenPrecio {
  almacen: string
  precio: number
  fecha: string
}

/** Historial de precio de un EAN (modelo futuro; no hay datos todavía). */
export interface HistorialPrecio {
  ean: string
  puntos: Array<{ fecha: string; precio: number }>
}

export const LIST_STORAGE_KEY = 'lupa:lista'

/**
 * Normaliza un EAN: quita separadores típicos (espacios, guiones, puntos,
 * guiones bajos) y pasa a mayúsculas. "779 3940 219009" y "7793940219009" son
 * el mismo código — el mismo defecto que precio-scanner listaba en su README.
 */
export function normalizeEan(raw: string): string {
  return String(raw ?? '').trim().toUpperCase().replace(/[\s\-._]+/g, '')
}

/** Agrega el producto por EAN; si ya está, incrementa la cantidad. */
export function addItem(
  list: ListaItem[],
  ean: string,
  nombre?: string,
): ListaItem[] {
  const key = normalizeEan(ean)
  if (!key) return list.slice()
  const existing = list.find((i) => i.ean === key)
  if (existing) {
    return list.map((i) =>
      i.ean === key ? { ...i, cantidad: i.cantidad + 1 } : i,
    )
  }
  return [...list, { ean: key, cantidad: 1, alerta: false, nombre }]
}

/** Fija la cantidad de un ítem (0 elimina; negativos se ignoran). */
export function setCantidad(
  list: ListaItem[],
  ean: string,
  cantidad: number,
): ListaItem[] {
  const key = normalizeEan(ean)
  if (cantidad < 0) return list.slice()
  if (cantidad === 0) return list.filter((i) => i.ean !== key)
  return list.map((i) => (i.ean === key ? { ...i, cantidad } : i))
}

export function removeItem(list: ListaItem[], ean: string): ListaItem[] {
  const key = normalizeEan(ean)
  return list.filter((i) => i.ean !== key)
}

export function toggleAlerta(list: ListaItem[], ean: string): ListaItem[] {
  const key = normalizeEan(ean)
  return list.map((i) => (i.ean === key ? { ...i, alerta: !i.alerta } : i))
}

export function isInList(list: ListaItem[], ean: string): boolean {
  return list.some((i) => i.ean === normalizeEan(ean))
}