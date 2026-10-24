import { normalizeEan } from './list'

/**
 * Lo escaneado en esta sesión, acumulado en memoria.
 *
 * La regla de producto: entra **solo lo que el catálogo pudo resolver** (un código
 * desconocido no tiene fila que mostrar y ya avisa en el dock), y el acumulado
 * **vive lo que vive la pantalla** — no se persiste, así que no promete memoria
 * que no tiene.
 *
 * Es un módulo puro, como `list.ts`: la pantalla solo lo cablea. La clave es el
 * EAN normalizado —el mismo de `Mi lista`—, así que `779-0895 000001` y
 * `7790895000001` son el mismo producto, igual que en `addItem`.
 */

export interface ScannedItem {
  /** EAN normalizado: la clave de identidad de la fila. */
  ean: string
  nombre: string
  precio: number
  /** Cuántas veces se escaneó este EAN en la sesión. */
  veces: number
}

/** El producto resuelto que entra al acumulado. */
export interface ScannedEntry {
  ean: string
  nombre: string
  precio: number
}

/**
 * Inserta arriba si el EAN es nuevo; si ya está, **suma una lectura sin moverlo**
 * (una fila que salta al tope mientras escaneás es una lista que no se puede
 * seguir con el dedo). Un EAN vacío no entra y deja el acumulado intacto.
 */
export function addScanned(items: ScannedItem[], entrada: ScannedEntry): ScannedItem[] {
  const key = normalizeEan(entrada.ean)
  if (!key) return items

  const existing = items.findIndex((i) => i.ean === key)
  if (existing === -1) {
    return [{ ean: key, nombre: entrada.nombre, precio: entrada.precio, veces: 1 }, ...items]
  }
  return items.map((item, index) =>
    index === existing ? { ...item, nombre: entrada.nombre, precio: entrada.precio, veces: item.veces + 1 } : item,
  )
}

/**
 * Quita la fila y devuelve **dónde estaba**, que es lo único que permite un
 * `Deshacer` que devuelve lo mismo y en el mismo lugar. Si el EAN no está, no
 * inventa nada: devuelve las filas intactas y `removed: null`.
 */
export function removeScanned(
  items: ScannedItem[],
  ean: string,
): { items: ScannedItem[]; removed: { item: ScannedItem; index: number } | null } {
  const key = normalizeEan(ean)
  const index = items.findIndex((i) => i.ean === key)
  if (index === -1) return { items, removed: null }
  return {
    items: items.filter((_, i) => i !== index),
    removed: { item: items[index]!, index },
  }
}

/**
 * Deshacer de `removeScanned`: repone la fila en la posición registrada. Si
 * mientras tanto ese EAN volvió a escanearse, no se duplica (el acumulado ya la
 * tiene y la fila nueva es la lectura más reciente).
 */
export function restoreScanned(items: ScannedItem[], item: ScannedItem, index: number): ScannedItem[] {
  if (items.some((i) => i.ean === item.ean)) return items
  const at = Math.max(0, Math.min(index, items.length))
  return [...items.slice(0, at), item, ...items.slice(at)]
}
