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

/**
 * Reinserta un ítem EXACTO en su índice original (undo de removeItem).
 *
 * A diferencia de `addItem`, conserva `cantidad`, `alerta`, `nombre` y
 * `productoId` tal como venían: deshacer un borrado no debe re-derivar estado
 * ni aplicar defaults. El índice se recorta a `[0, list.length]`, y si el EAN
 * ya está en la lista devuelve una copia sin tocar (nunca duplica).
 */
export function restoreItem(
  list: ListaItem[],
  item: ListaItem,
  index: number,
): ListaItem[] {
  const key = normalizeEan(item.ean)
  if (list.some((i) => i.ean === key)) return list.slice()
  const at = Math.max(0, Math.min(list.length, Math.trunc(index) || 0))
  return [...list.slice(0, at), { ...item, ean: key }, ...list.slice(at)]
}

/**
 * Reconstruye la lista tras un vaciado sin perder lo agregado mientras tanto.
 *
 * `snapshot` es lo que el usuario está restaurando, así que gana ante un EAN
 * duplicado; de `current` sólo se agregan los EAN que no estaban en el snapshot,
 * conservando el orden relativo de `current`. Todos los campos se copian verbatim
 * — deshacer no re-deriva defaults — y ninguno de los dos arrays se muta. Los EAN
 * se comparan y devuelven normalizados (mismo idioma que `restoreItem`).
 */
export function restoreList(snapshot: ListaItem[], current: ListaItem[]): ListaItem[] {
  const seen = new Set(snapshot.map((i) => normalizeEan(i.ean)))
  const merged = snapshot.map((i) => ({ ...i, ean: normalizeEan(i.ean) }))
  for (const item of current) {
    const key = normalizeEan(item.ean)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({ ...item, ean: key })
  }
  return merged
}

export function toggleAlerta(list: ListaItem[], ean: string): ListaItem[] {
  const key = normalizeEan(ean)
  return list.map((i) => (i.ean === key ? { ...i, alerta: !i.alerta } : i))
}

export function isInList(list: ListaItem[], ean: string): boolean {
  return list.some((i) => i.ean === normalizeEan(ean))
}

/** Vacía la lista completa (retorna una lista vacía, lista para persistir). */
export function clearList(): ListaItem[] {
  return []
}