/**
 * cercania — splits the priced branches into "your city" and "the rest".
 *
 * WHY this exists (measured 2026-10-02, recorded in
 * `odd/tasks/sucursales-en-detalle.md` §Slice 3): the list arrives price-ascending,
 * so on the recorded Río Gallegos fixture the user's own city branches land at
 * positions 14–23 while the first 13 rows are ~260 km away in Río Grande. The
 * section is titled "sucursales cercanas" and was delivering a national price
 * ranking — the user stands 0.62 km from a store and sees another province first.
 * It is the same "cheapest anywhere vs nearest" trap that removed the delta,
 * surviving in the ORDER instead of in a number.
 *
 * The API never says where the user is, so "your city" is inferred from the
 * nearest branch's own `localidad`, and only when that branch is close enough.
 * The threshold is what stops the app from telling a user in Río Gallegos that
 * they live in Rada Tilly (644 km away): below it the label is plausible, above
 * it there is no honest city to claim. On the recorded data the gap is two orders
 * of magnitude wide (≤5.35 km in-city vs ≥260 km out of city), so any value
 * between ~6 and ~260 km answers the same with these fixtures; 50 km is an
 * explicit, reversible choice. Turn it off by comparing with a very large value.
 *
 * Pure: no network, no React, no sorting. The caller already holds a price-first
 * order (distance as tiebreak) from `mapSucursales`; re-sorting here would
 * silently change the price ordering the whole feature is built on.
 */
import type { SucursalPrecio } from './map'

/** Above this, the nearest branch is not plausibly in the user's city. */
export const UMBRAL_MISMA_CIUDAD_KM = 50

export interface GruposPorCercania {
  /** The API's own locality label, or null when no branch is near enough to claim one. */
  localidad: string | null
  /** Branches in that locality, inside the threshold. */
  cerca: SucursalPrecio[]
  /** Everything else. */
  lejos: SucursalPrecio[]
}

/** A null distance is "unknown": never nearer than a real one. */
function distanciaDe(sucursal: SucursalPrecio): number {
  return sucursal.distanciaNumero ?? Number.POSITIVE_INFINITY
}

/**
 * Comparison key for locality labels ONLY. The API's labels are dirty
 * (`9 De Julio` vs `9 de julio`, `ACASSUSO` vs `Acassuso`), so grouping trims,
 * lowercases and collapses internal whitespace runs. The value returned as
 * `localidad` keeps the API's original casing and spacing.
 */
function normalizarLocalidad(localidad: string | null): string {
  return (localidad ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Groups the branches by "same locality as the nearest one" when that nearest one
 * is close enough, otherwise returns every branch as `lejos` with no locality.
 * The returned `cerca` and `lejos` preserve the incoming order and together
 * contain every branch exactly once (there is no third bucket, nothing dropped).
 */
export function agruparPorCercania(
  sucursales: SucursalPrecio[],
  umbralKm: number = UMBRAL_MISMA_CIUDAD_KM,
): GruposPorCercania {
  if (sucursales.length === 0) {
    return { localidad: null, cerca: [], lejos: [] }
  }

  // No branch carries a distance: there is no basis to infer a city.
  if (!sucursales.some((sucursal) => sucursal.distanciaNumero !== null)) {
    return { localidad: null, cerca: [], lejos: sucursales }
  }

  let masCercana = sucursales[0]
  for (const sucursal of sucursales) {
    if (distanciaDe(sucursal) < distanciaDe(masCercana)) masCercana = sucursal
  }

  const localidadNormalizada = normalizarLocalidad(masCercana.localidad)
  // Beyond the threshold, or with no usable locality label: claiming a city
  // would be a new lie, so none is claimed.
  if (localidadNormalizada === '' || distanciaDe(masCercana) > umbralKm) {
    return { localidad: null, cerca: [], lejos: sucursales }
  }

  const cerca: SucursalPrecio[] = []
  const lejos: SucursalPrecio[] = []
  for (const sucursal of sucursales) {
    const mismaLocalidad = normalizarLocalidad(sucursal.localidad) === localidadNormalizada
    const dentroDelUmbral =
      sucursal.distanciaNumero !== null && sucursal.distanciaNumero <= umbralKm
    if (mismaLocalidad && dentroDelUmbral) {
      cerca.push(sucursal)
    } else {
      lejos.push(sucursal)
    }
  }

  return { localidad: masCercana.localidad, cerca, lejos }
}
