/**
 * Product image sources.
 *
 * Product photos come from the Argentina government "Precios Claros" image CDN,
 * keyed by the product EAN:
 *   https://imagenes.preciosclaros.gob.ar/productos/{ean}.jpg
 *
 * The CDN serves exactly ONE variant per EAN (verified 2026-02, EAN
 * 7790710000102): every query string (?size=, ?width=, ?w=, ?quality=, …)
 * returns a byte-identical 47 kB file, and alternate paths (_mediana, _thumb,
 * /thumbs/, /small/) answer 403. There is no size/variant parameter to use —
 * thumbnails download the full image and it is object-cover'd into a fixed box;
 * re-probe only if the CDN ever grows a real resize API.
 *
 * A code only maps to an image when it looks like a real EAN (>= 6 digits);
 * barcode-less products and bogus/too-short codes have no image and the UI falls
 * back to a category emoji.
 */
const PRECIOS_CLAROS_IMAGE = 'https://imagenes.preciosclaros.gob.ar/productos'

const MIN_IMAGE_EAN_DIGITS = 6

/** Digits-only EAN when it is long enough for a real code, else undefined. */
export function usableEan(ean: string | undefined): string | undefined {
  if (!ean) return undefined
  const digits = String(ean).replace(/\D/g, '')
  return digits.length >= MIN_IMAGE_EAN_DIGITS ? digits : undefined
}

/** Precios Claros image URL for the EAN, or undefined when there is no image. */
export function productImageSrc(ean: string | undefined): string | undefined {
  const digits = usableEan(ean)
  return digits ? `${PRECIOS_CLAROS_IMAGE}/${digits}.jpg` : undefined
}