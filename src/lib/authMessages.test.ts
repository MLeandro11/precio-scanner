import { describe, it, expect } from 'vitest'
import { describeAuthError, isSilentAuthCode } from './authMessages'

describe('describeAuthError', () => {
  it('names the setup mistake for a provider that is still disabled', () => {
    expect(describeAuthError('auth/operation-not-allowed')).toMatch(/habilitado en la consola/)
  })

  it('names the setup mistake for a host missing from the allowed list', () => {
    expect(describeAuthError('auth/unauthorized-domain')).toMatch(/Authorized domains/)
  })

  it('falls back to the code so an unmapped failure is still diagnosable', () => {
    expect(describeAuthError('auth/some-new-code')).toContain('auth/some-new-code')
  })

  it('catches the api-key failure despite its variable tail', () => {
    // The exact code Firebase returned when the sign-in path was run against a project that
    // does not exist. An equality match missed it and reported an opaque code instead.
    expect(
      describeAuthError('auth/api-key-not-valid.-please-pass-a-valid-api-key.'),
    ).toMatch(/VITE_FIREBASE_/)
  })

  it('never renders an empty parenthesis for a missing code', () => {
    // a rejected promise can carry anything; `undefined` must not produce "(undefined)."
    expect(describeAuthError(undefined)).toBe('No se pudo iniciar sesión.')
    expect(describeAuthError(undefined)).not.toContain('(')
    expect(describeAuthError(42)).toBe('No se pudo iniciar sesión.')
  })
})

describe('isSilentAuthCode', () => {
  it('treats a dismissed popup as a decision, not a failure', () => {
    expect(isSilentAuthCode('auth/popup-closed-by-user')).toBe(true)
    expect(isSilentAuthCode('auth/cancelled-popup-request')).toBe(true)
  })

  it('does not silence a real failure', () => {
    expect(isSilentAuthCode('auth/operation-not-allowed')).toBe(false)
    expect(isSilentAuthCode('')).toBe(false)
  })
})
