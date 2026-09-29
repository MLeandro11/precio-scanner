/**
 * describeCatalogError — pure mapper from a thrown catalog error to
 * user-facing Argentine Spanish copy (no network, no SDK; unit-tested in
 * plain Node like the auth and Firestore mappers).
 *
 * Renamed from describeSearchError: the boot path (App's ErrorScreen) now
 * feeds catalogLoader failures through it too, so the name no longer
 * pretends this is a search-only concern.
 *
 * CONTRACT
 *   - The raw error text is used ONLY to choose a branch. It is never echoed:
 *     no URLs, statuses, stack frames or English SDK strings reach the user.
 *   - Branch only on the failure modes this codebase actually produces
 *     (src/lib/catalogLoader.ts, src/lib/workerClient.ts). Anything
 *     unrecognized falls through to an honest generic case: never invent a
 *     cause the evidence does not support.
 *   - DESIGN.md: "an explicit reason plus one recovery action when there is
 *     no data", and "errors name the problem and the recovery" — the mapped
 *     pair is rendered by ProductList's error state with a real retry button.
 *
 * Widget-catalog failure modes (the worker reads these files) and the
 * catalogLoader error strings they key on:
 *   - "failed to download <path> (<status>)" and "offline with no cached
 *     facets" → the bytes never arrived (offline / bad connection / server
 *     error) → user recoverable by retrying on a better connection.
 *   - "invalid JSON for <label>" → the bytes arrived but are not the catalog →
 *     server-side data problem. Honest hint: retry may help, else the file is
 *     broken server-side; we cannot tell which from here.
 *   - "HTML instead of JSON" → an SPA fallback answered: the server answered
 *     with something that is not the catalog (classic cause: dev server
 *     started before public/data/ was generated). User cannot fix it; the
 *     hint says so and names (not instructs) the maintainer case.
 */
export interface SearchErrorDescription {
  title: string
  hint?: string
}

export function describeCatalogError(err: unknown): SearchErrorDescription {
  const msg = err instanceof Error ? err.message : String(err ?? '')

  if (/failed to download|offline with no cached/.test(msg)) {
    return {
      title: 'No se pudo descargar el catálogo.',
      hint: 'Revisá tu conexión a internet y probá de nuevo.',
    }
  }

  if (/invalid JSON/.test(msg)) {
    return {
      title: 'El catálogo llegó dañado o incompleto.',
      hint: 'Probá de nuevo; si el error sigue, el archivo del servidor está dañado.',
    }
  }

  if (/HTML instead of JSON/.test(msg)) {
    return {
      title: 'El servidor respondió con una página, no con el catálogo.',
      hint: 'Probá de nuevo; si el error sigue, avisá al mantenedor.',
    }
  }

  // Fallthrough: the error speaks English but the user should not have to.
  return {
    title: 'Ocurrió un error al buscar.',
    hint: 'Probá de nuevo; si el error sigue, avisá al mantenedor.',
  }
}
