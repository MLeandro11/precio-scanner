/**
 * clipboard — copy text without ever throwing at the caller.
 *
 * Two mechanisms, in the order the platform prefers: the async Clipboard API when
 * the browser exposes it, and a hidden textarea + `execCommand('copy')` otherwise.
 * Every failure degrades to `false`; the UI decides what to say about it. A copy
 * that did not happen must never be reported as one.
 */

/** One EAN per line: the shape that pastes into a spreadsheet, in list order. */
export function formatEanLines(eans: readonly string[]): string {
  return eans
    .map((ean) => (typeof ean === 'string' ? ean.trim() : ''))
    .filter((ean) => ean.length > 0)
    .join('\n')
}

/**
 * Resolves `true` only when the platform confirmed the write. A missing or
 * rejecting Clipboard API falls through to the legacy path; if that is
 * unavailable too, the result is `false`.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Permission denied or an unfocused document: try the legacy path below.
    }
  }

  // No DOM, no fallback: environments without a document cannot copy.
  if (typeof document === 'undefined') return false

  let textarea: HTMLTextAreaElement | null = null
  try {
    if (!document.body || typeof document.createElement !== 'function') return false
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    // Off-layout and invisible: the node must never flash or shift the page.
    if (el.style) {
      el.style.position = 'fixed'
      el.style.top = '0'
      el.style.left = '0'
      el.style.opacity = '0'
      el.style.pointerEvents = 'none'
    }
    textarea = el
    document.body.appendChild(el)
    el.focus()
    el.select()
    if (typeof document.execCommand !== 'function') return false
    return document.execCommand('copy') === true
  } catch {
    return false
  } finally {
    // Always detach, on success and on failure alike.
    if (textarea && document.body) {
      try {
        document.body.removeChild(textarea)
      } catch {
        // Already detached; nothing left to clean up.
      }
    }
  }
}
