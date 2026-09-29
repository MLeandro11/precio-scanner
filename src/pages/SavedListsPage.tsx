import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import Brand from '../components/Brand'
import Button from '../components/ui/Button'
import { defaultListName, formatSavedDate } from '../lib/firestoreLists'
import type { SavedList } from '../lib/firestoreLists'
import { useList } from '../hooks/useList'
import { useSavedLists } from '../hooks/useSavedLists'

/**
 * Listas guardadas (FR-12) — the page where a snapshot of the working list is written to the
 * account, and where the snapshots already saved are listed.
 *
 * Saving lives here rather than on `/lista` for a measured reason, not a stylistic one:
 * `useSavedLists` reaches `useAuth`, which loads the Firebase SDK on mount, and `/lista` is a
 * core route that must not pull a lazily-fetched chunk sitting deliberately outside the
 * precache. So `/lista` links here and this page owns the session.
 *
 * Saving is additive by construction (FR-12.2): `addDoc` mints a new id, so "overwrite an
 * existing list" is not a bug to avoid — it is not expressible.
 */
export default function SavedListsPage() {
  const { items } = useList()
  const { state, actionError, save, remove, restore, reload, signIn } = useSavedLists()
  const [nombre, setNombre] = useState(() => defaultListName(new Date()))
  const [busy, setBusy] = useState(false)

  // A failed read still means "signed in": the uid existed, the request did not survive.
  const signedIn = state.status === 'ready' || state.status === 'error'
  const canSave = signedIn && items.length > 0 && !busy

  async function onSave() {
    setBusy(true)
    const ok = await save(nombre.trim() || defaultListName(new Date()), items)
    setBusy(false)
    if (!ok) return
    setNombre(defaultListName(new Date()))
    toast('Lista guardada', {
      description: `${items.length} producto${items.length === 1 ? '' : 's'} en tu cuenta`,
    })
  }

  function onRemove(list: SavedList) {
    void remove(list).then((ok) => {
      if (!ok) return
      // Same safety model as the working list: reversible, not prevented (FR-12.10).
      // The undo restores the same id and the same date, so the list really comes back.
      toast('Lista borrada', {
        description: list.nombre,
        action: { label: 'Deshacer', onClick: () => void restore(list) },
      })
    })
  }

  return (
    <main className="safe-top mx-auto w-full max-w-lg px-4 pb-8">
      <div className="flex items-center justify-between">
        <Brand />
        <Link
          to="/lista"
          className="text-xs font-medium text-text-secondary underline-offset-2 hover:underline"
        >
          ← Mi lista
        </Link>
      </div>

      <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-text-secondary">
        Guardar la lista actual
      </h2>

      <div className="mt-2 rounded-xl border border-border bg-surface-raised p-4" data-save-list>
        {!signedIn ? (
          <p className="text-xs text-text-secondary">
            Necesitás una sesión para guardar listas. Tu lista de trabajo no se toca: sigue en
            este dispositivo.
          </p>
        ) : (
          <>
            <label htmlFor="nombre-lista" className="text-xs font-medium text-text-secondary">
              Nombre
            </label>
            <input
              id="nombre-lista"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={80}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
            />
            <Button
              variant="primary"
              className="mt-3 w-full"
              disabled={!canSave}
              onClick={() => void onSave()}
            >
              <Save size={16} aria-hidden="true" />
              {items.length === 0
                ? 'La lista está vacía'
                : `Guardar ${items.length} producto${items.length === 1 ? '' : 's'}`}
            </Button>
          </>
        )}
      </div>

      <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-text-secondary">
        Mis listas
      </h2>

      <div data-saved-lists-state={state.status}>
        {state.status === 'unconfigured' ? (
          <p className="mt-2 text-sm text-text-secondary">
            Este build no tiene Firebase configurado, así que las listas guardadas no están
            disponibles. El resto de la app funciona igual.
          </p>
        ) : state.status === 'signed-out' ? (
          <div className="mt-2 rounded-xl border border-border bg-surface-raised p-4">
            <p className="text-sm font-semibold text-text-primary">Iniciá sesión</p>
            <p className="mt-1 text-xs text-text-secondary">
              Tus listas guardadas quedan en tu cuenta. La lista de trabajo no se sube sola.
            </p>
            <div className="mt-3">
              <Button variant="secondary" className="w-full" onClick={() => void signIn()}>
                Continuar con Google
              </Button>
            </div>
          </div>
        ) : state.status === 'loading' ? (
          <p className="mt-2 text-sm text-text-secondary" role="status">
            Cargando listas…
          </p>
        ) : state.status === 'error' ? (
          /* An unreachable backend is not an empty account (FR-12.9): it says what failed and
             offers the retry, instead of claiming there is nothing saved. */
          <div className="mt-2 rounded-xl border border-danger/30 bg-danger/5 p-4">
            <p role="alert" className="text-sm text-danger">
              {state.message}
            </p>
            <Button variant="secondary" className="mt-3 w-full" onClick={() => void reload()}>
              Reintentar
            </Button>
          </div>
        ) : state.lists.length === 0 ? (
          <p className="mt-2 text-sm text-text-secondary">
            Todavía no guardaste ninguna lista.
          </p>
        ) : (
          <ul className="mt-2 space-y-2" data-saved-lists-count={state.lists.length}>
            {state.lists.map((list) => (
              <li key={list.id} className="rounded-2xl border border-border bg-surface-raised p-3">
                <div className="flex items-center gap-3">
                  <Link to={`/guardadas/${list.id}`} className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-text-primary">
                      {list.nombre}
                    </p>
                    <p className="text-[11px] text-text-secondary">
                      {list.items.length} producto{list.items.length === 1 ? '' : 's'}
                      {formatSavedDate(list.creada) ? ` · ${formatSavedDate(list.creada)}` : ''}
                    </p>
                  </Link>
                  <button
                    type="button"
                    onClick={() => onRemove(list)}
                    aria-label={`Borrar ${list.nombre}`}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-text-muted transition hover:text-danger"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {actionError ? (
          <p role="alert" className="mt-3 text-xs text-danger">
            {actionError}
          </p>
        ) : null}
      </div>
    </main>
  )
}
