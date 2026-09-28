import type { Firestore } from 'firebase/firestore'
import { readFirebaseConfig } from './firebaseConfig'
import type { FirebaseConfig } from './firebaseConfig'
import type { ListaItem } from './lupa/list'

/**
 * firestoreLists — saved lists (FR-12) and the Firestore SDK, loaded on demand.
 *
 * The working list never leaves the device (FR-12.1). This module is the only path to
 * the cloud, and it is reached only from an explicit save or from the saved-lists page.
 * Two deliberate shapes follow from that:
 *
 * - The mapping is **pure and SDK-free**, so it is unit-testable in plain Node. The
 *   Firestore calls need a session and a network; the mapping does not, and the mapping
 *   is where data actually gets lost.
 * - No `firebase/*` type crosses the boundary. `creada` is an ISO string here, which is
 *   what keeps the SDK out of React state.
 */

/** A saved list as stored: items embedded in the document (FR-12.3). */
export interface SavedListDoc {
  nombre: string
  /** ISO 8601. A Firestore Timestamp on the wire, converted at this boundary. */
  creada: string
  items: ListaItem[]
}

/** A saved list as the app reads it. */
export interface SavedList extends SavedListDoc {
  id: string
}

export interface FirestoreClient {
  db: Firestore
  mod: typeof import('firebase/firestore')
}

/** Thrown when this build has no Firebase config, so callers can name the reason. */
export const FIREBASE_NOT_CONFIGURED = 'firebase-not-configured'

/**
 * Maps a thrown Firestore error to a message the UI can show. Pure, so it is unit-tested
 * like the mapper — and it exists because FR-12.9 requires a failed read to be *legible*:
 * an unreachable backend must not look like an empty account.
 */
export function describeFirestoreError(err: unknown): string {
  if (err instanceof Error && err.message === FIREBASE_NOT_CONFIGURED) {
    return 'Este build no tiene Firebase configurado.'
  }
  const code = (err as { code?: unknown } | null | undefined)?.code
  if (code === 'permission-denied') return 'Tu cuenta no tiene permiso para ver esas listas.'
  if (code === 'unavailable') return 'Sin conexión con el servidor. Probá de nuevo.'
  if (code === 'failed-precondition') return 'Falta un índice en la base. Avisá al mantenedor.'
  /*
   * `not-found` here is not a missing document — `getSavedList` checks `exists()` instead of
   * throwing, and a `getDocs` on a collection never 404s for an empty one. It is the backend
   * saying the `(default)` database does not exist at all, which the SDK also announces with a
   * console warning ("Database '(default)' not found. Please check your project
   * configuration."). That is a provisioning step, not a bug in the app, and saying so beats a
   * generic shrug that sends the reader hunting for a defect that is not there.
   */
  if (code === 'not-found') {
    return 'La base de datos de Firestore no existe en el proyecto. Creala en la consola de Firebase.'
  }
  return 'No se pudieron leer las listas guardadas.'
}

/**
 * Firestore rejects `undefined` field values outright, and `nombre`/`productoId` are
 * optional on ListaItem — so an item copied straight from the working list would fail
 * the write. Dropping the key, rather than writing `undefined`, is the whole job here.
 * A fresh object is built so the caller's list is never mutated.
 */
function serializeItem(item: ListaItem): ListaItem {
  const out: ListaItem = { ean: item.ean, cantidad: item.cantidad, alerta: item.alerta }
  if (item.nombre !== undefined) out.nombre = item.nombre
  if (item.productoId !== undefined) out.productoId = item.productoId
  return out
}

export function toDocument(nombre: string, items: ListaItem[]): Omit<SavedListDoc, 'creada'> {
  return { nombre, items: items.map(serializeItem) }
}

/**
 * The same shape guard `useList` applies to localStorage, for the same reason: the
 * wire is not trusted. Malformed entries are dropped and the rest survive, so a
 * half-corrupt document degrades instead of throwing the page away.
 */
function parseItems(value: unknown): ListaItem[] {
  if (!Array.isArray(value)) return []
  const out: ListaItem[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue
    const it = raw as Record<string, unknown>
    if (typeof it.ean !== 'string' || typeof it.cantidad !== 'number') continue
    const parsed: ListaItem = { ean: it.ean, cantidad: it.cantidad, alerta: it.alerta === true }
    if (typeof it.nombre === 'string') parsed.nombre = it.nombre
    if (typeof it.productoId === 'string') parsed.productoId = it.productoId
    out.push(parsed)
  }
  return out
}

/**
 * A Firestore Timestamp arrives in one of two shapes: the class instance, which exposes
 * `toDate()`, or the plain `{ seconds, nanoseconds }` it serialises to. Anything else is
 * corrupt data, and a corrupt date must not make the list unreadable — hence `''` rather
 * than a throw or an `Invalid Date`.
 */
function toIsoString(value: unknown): string {
  if (typeof value === 'string') return Number.isNaN(Date.parse(value)) ? '' : value
  if (typeof value !== 'object' || value === null) return ''
  const maybe = value as { toDate?: unknown; seconds?: unknown }
  if (typeof maybe.toDate === 'function') {
    const date = (maybe.toDate as () => unknown).call(value)
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : ''
  }
  if (typeof maybe.seconds === 'number' && Number.isFinite(maybe.seconds)) {
    return new Date(maybe.seconds * 1000).toISOString()
  }
  return ''
}

export function fromDocument(id: string, data: unknown): SavedList {
  const doc = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
  return {
    id,
    nombre: typeof doc.nombre === 'string' ? doc.nombre : '',
    creada: toIsoString(doc.creada),
    items: parseItems(doc.items),
  }
}

let loading: Promise<FirestoreClient | null> | null = null

/** Resolves to `null` when this build has no Firebase config, which is the normal case in CI. */
export function getFirestoreClient(): Promise<FirestoreClient | null> {
  const config = readFirebaseConfig(import.meta.env)
  if (!config) return Promise.resolve(null)
  if (!loading) {
    loading = load(config).catch((err: unknown) => {
      loading = null
      throw err
    })
  }
  return loading
}

/**
 * IndexedDB is where the persistent cache lives, and some private modes refuse it. The
 * capability is probed *before* initializing rather than caught afterwards, because
 * `initializeFirestore` throws if it is called twice on one app — a retry after a failed
 * attempt is not a safe recovery path.
 */
function supportsIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

async function load(config: FirebaseConfig): Promise<FirestoreClient> {
  const [appMod, firestoreMod] = await Promise.all([
    import('firebase/app'),
    import('firebase/firestore'),
  ])
  const app = appMod.initializeApp(config)
  /*
   * `initializeFirestore`, not `getFirestore`, because FR-12.9 needs an already-fetched
   * saved list to open with no network. Without IndexedDB the cache falls back to memory,
   * so the list reads online-only instead of not reading at all.
   */
  const localCache = supportsIndexedDb()
    ? firestoreMod.persistentLocalCache()
    : firestoreMod.memoryLocalCache()
  return { db: firestoreMod.initializeFirestore(app, { localCache }), mod: firestoreMod }
}

async function requireClient(): Promise<FirestoreClient> {
  const client = await getFirestoreClient()
  if (!client) throw new Error(FIREBASE_NOT_CONFIGURED)
  return client
}

/**
 * `users/{uid}/lists` — the only collection this app owns (FR-12.7). Written as explicit path
 * segments rather than a spread of an array, because the SDK's overloads cannot type a spread
 * of `string[]` and silently resolve to the wrong overload when they try.
 */
function listsCol(client: FirestoreClient, uid: string) {
  return client.mod.collection(client.db, 'users', uid, 'lists')
}

function listDoc(client: FirestoreClient, uid: string, id: string) {
  return client.mod.doc(client.db, 'users', uid, 'lists', id)
}

/**
 * Always a new snapshot: `addDoc` mints the id, so overwriting an existing saved list is
 * not merely avoided by convention — it is not expressible here (FR-12.2).
 */
export async function saveList(
  uid: string,
  nombre: string,
  items: ListaItem[],
): Promise<string> {
  const client = await requireClient()
  const { addDoc, serverTimestamp } = client.mod
  const ref = await addDoc(listsCol(client, uid), {
    ...toDocument(nombre, items),
    creada: serverTimestamp(),
  })
  return ref.id
}

/**
 * Newest first. Every write sets `creada`, which matters here: an `orderBy` on a field
 * silently excludes documents that lack it.
 */
export async function listSavedLists(uid: string): Promise<SavedList[]> {
  const client = await requireClient()
  const { getDocs, orderBy, query } = client.mod
  const snap = await getDocs(query(listsCol(client, uid), orderBy('creada', 'desc')))
  return snap.docs.map((d) => fromDocument(d.id, d.data()))
}

export async function getSavedList(uid: string, id: string): Promise<SavedList | null> {
  const client = await requireClient()
  const { getDoc } = client.mod
  const snap = await getDoc(listDoc(client, uid, id))
  return snap.exists() ? fromDocument(snap.id, snap.data()) : null
}

export async function deleteSavedList(uid: string, id: string): Promise<void> {
  const client = await requireClient()
  const { deleteDoc } = client.mod
  await deleteDoc(listDoc(client, uid, id))
}

/**
 * Puts a deleted snapshot back **exactly** as it was — same id, same `creada`, same items —
 * which is what makes the delete undoable (FR-12.10) rather than merely regrettable. A plain
 * re-save would mint a new id and stamp a new date, so the list would come back as a different
 * object that happens to look the same.
 *
 * `creada` is written back as a Timestamp rather than the ISO string, so the field keeps one
 * type across documents; mixing the two would quietly break the `orderBy` in `listSavedLists`,
 * which sorts by type before value.
 */
export async function restoreSavedList(uid: string, list: SavedList): Promise<void> {
  const client = await requireClient()
  const { doc, serverTimestamp, setDoc, Timestamp } = client.mod
  const date = new Date(list.creada)
  await setDoc(doc(client.db, 'users', uid, 'lists', list.id), {
    ...toDocument(list.nombre, list.items),
    creada: Number.isNaN(date.getTime()) ? serverTimestamp() : Timestamp.fromDate(date),
  })
}

/**
 * The default name for a new snapshot (FR-12.2): derived from the date, and editable before
 * saving. Local date on purpose — "hoy" is the user's day, not UTC's.
 */
export function defaultListName(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `Lista del ${d}/${m}/${date.getFullYear()}`
}

/**
 * Renders `creada` for display, or `''` when the stored date is unusable — a corrupt date
 * must cost the date, not the list.
 */
export function formatSavedDate(iso: string, locale = 'es-AR'): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
}
