/**
 * authMessages — Firebase error codes turned into something a person can act on.
 *
 * Two of these are not edge cases but the first things anyone hits while setting the project
 * up: `operation-not-allowed` means the provider is still disabled in the console, and
 * `unauthorized-domain` means the host is missing from the allowed list. Both are otherwise
 * reported as an opaque code in a popup that closes itself.
 *
 * Pure and tested on purpose: the mapping is the only part of the sign-in path that can be
 * verified without a live Firebase project.
 */

/** Dismissing the popup is a decision, not a failure — callers must not surface it. */
export const SILENT_AUTH_CODES = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request']

export function isSilentAuthCode(code: unknown): boolean {
  return typeof code === 'string' && SILENT_AUTH_CODES.includes(code)
}

export function describeAuthError(code: unknown): string {
  const id = typeof code === 'string' ? code : ''

  // Matched by prefix, not equality: Firebase emits the api-key failure as
  // `auth/api-key-not-valid.-please-pass-a-valid-api-key.` — a code with a variable tail that
  // an exact case silently missed and reported as an unknown error. Found by running the
  // sign-in path against a project that does not exist.
  if (id === 'auth/invalid-api-key' || id.startsWith('auth/api-key-not-valid')) {
    return 'La configuración de Firebase no es válida. Revisá las variables VITE_FIREBASE_*.'
  }

  switch (id) {
    case 'auth/operation-not-allowed':
      // Named rather than generic: with a single provider, "that provider" would leave the
      // reader guessing which one, and `signIn` no longer takes an argument.
      return 'Google no está habilitado en la consola de Firebase.'
    case 'auth/unauthorized-domain':
      return 'Este dominio no está autorizado en Firebase. Agregalo en Authentication → Settings → Authorized domains.'
    case 'auth/popup-blocked':
      return 'El navegador bloqueó la ventana de login. Permitila y reintentá.'
    case 'auth/network-request-failed':
      return 'Sin conexión: iniciar sesión necesita red.'
    default:
      return id ? `No se pudo iniciar sesión (${id}).` : 'No se pudo iniciar sesión.'
  }
}
