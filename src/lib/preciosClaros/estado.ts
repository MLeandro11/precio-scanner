/**
 * estado — derives the one of the three states the product-detail UI must
 * distinguish. Pure and dependency-free (only reads the response DTOs).
 *
 *   con-precios  ≥1 branch with a usable `precioLista`   → the table
 *   sin-precio   branches exist, none with a usable price → "No hay precio informado…"
 *   sin-datos    `total === 0` or `producto.msg` present  → "Nadie informa este código."
 *
 * An unknown EAN (`producto.msg`) and an empty `total` are NORMAL states, never
 * errors: the caller keeps the local price on screen and shows the honest copy.
 */
import { precioListaNumerico, tieneMensajeDeProducto } from './schema'
import type { ProductoResponse } from './schema'

export type EstadoSucursales = 'con-precios' | 'sin-precio' | 'sin-datos'

export function deriveEstado(
  response: ProductoResponse | null | undefined,
): EstadoSucursales {
  if (!response) return 'sin-datos'
  // "Producto inexistente." wins even if a malformed body also carried branches.
  if (tieneMensajeDeProducto(response)) return 'sin-datos'
  if (response.total === 0) return 'sin-datos'

  const sucursales = response.sucursales ?? []
  if (sucursales.some((sucursal) => precioListaNumerico(sucursal) !== null)) {
    return 'con-precios'
  }
  if (sucursales.length > 0) return 'sin-precio'
  // `total > 0` but this page has no branch entries (paging edge): nothing to show.
  return 'sin-datos'
}
