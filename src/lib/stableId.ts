import { createHash } from 'node:crypto'

/**
 * Stable product id: first 16 hex chars of sha256(normalized "nombre|marca").
 * Case-, accent- and whitespace-insensitive so catalog re-extractions keep ids
 * stable across naming inconsistencies like "coca cola" vs "Coca Cola".
 */
export function stableId(nombre: string, marca?: string): string {
  const norm = (s: string) =>
    String(s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  return createHash('sha256')
    .update(`${norm(nombre)}|${norm(marca ?? '')}`)
    .digest('hex')
    .slice(0, 16)
}