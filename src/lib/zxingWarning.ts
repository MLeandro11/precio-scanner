/**
 * zxingWarning — quiet the one benign warning @zxing/library@0.23.0 emits on
 * every decode miss, without touching any other console output.
 *
 * The upstream defect, in MultiFormatReader.decodeInternal (0.23.0):
 *
 *   catch (ex) {
 *     if (ex instanceof ReaderException) { continue }
 *     console.warn('MultiFormatReader: non-ReaderException from reader:', ex)
 *     continue
 *   }
 *
 * The intent is "log the unexpected ones". But in the JS port NotFoundException,
 * FormatException and ChecksumException each extend Exception directly — they are
 * siblings of ReaderException, not subclasses (see
 * node_modules/@zxing/library/esnext/core/{NotFoundException,FormatException,
 * ChecksumException}.js) — so every ordinary miss fails the `instanceof` guard
 * and is logged as if it were a bug. OneDReader.decode declares
 * `throws NotFoundException, FormatException`, which is the evidence that these
 * are expected outcomes rather than defects.
 *
 * This app asks for four linear formats on a 180 ms cycle, so the warning fires
 * roughly 22 times a second while the scanner is open. It is noise, not a fault:
 * decodeInternal keeps looping and the caller handles the final NotFoundException.
 *
 * The filter is deliberately narrow: the exact upstream message prefix, exactly
 * two operands, an Error, and exactly those three reader outcomes. Being precise
 * about what is forwarded:
 *
 *   - The outcome identifiers are compared by EXACT equality, never by substring.
 *     A class literally named `NotNotFoundException` or `SpecialFormatException`
 *     does NOT match. The stable `kind`/`getKind()` path still carries the literal
 *     outcome string in the production bundle, where the class name itself is
 *     minified to a single letter, so exact equality is workable here — held up
 *     by tests and by the SCAN-zxing-noise acceptance row.
 *   - The one widening that remains: `error.name` and `error.constructor.name`
 *     are also compared exactly, so any user code that sets `error.name = 
 *     'NotFoundException'` on an unrelated Error is suppressed too. That is what
 *     a conforming-but-hostile name can still do; it cannot be narrowed further
 *     without abandoning the name-based fallback that unminified bundles need.
 *   - Anything else (different message, different arity, non-Error operand, other
 *     exception classes, any operand that throws when read) is forwarded untouched.
 */

const MISS_MESSAGE_PREFIX = 'MultiFormatReader: non-ReaderException from reader:'

const EXPECTED_READER_OUTCOMES = ['NotFoundException', 'FormatException', 'ChecksumException']

/**
 * Outcome identifies: name, constructor.name, static kind, getKind().
 *
 * Every read is guarded: an operand we cannot inspect is NOT a known-expected
 * miss, so the safe default is to keep it visible. The filter must never throw
 * — a filter that can break the console is worse than the noise it removes.
 */
function outcomeIdentifiers(error: Error): string[] {
  const identifiers: string[] = []
  const push = (id: unknown): void => {
    if (typeof id === 'string' && id.length > 0) identifiers.push(id)
  }

  try {
    push(error.name)
    const ctor = error.constructor as (Function & { kind?: unknown }) | undefined
    push(ctor?.name)
    push(ctor?.kind)
    const getKind = (error as { getKind?: unknown }).getKind
    if (typeof getKind === 'function') push(getKind.call(error))
  } catch {
    // An unreadable identifier just contributes nothing; the rest still counts.
  }

  return identifiers
}

/**
 * True only for the exact MultiFormatReader miss the library emits for an
 * ordinary decode failure. Pure, operand-shape based, and total: it MUST return
 * a boolean for any input, it never throws (a throwing getter on `name`,
 * `constructor`, `getKind`, or the static `kind` contributes nothing instead of
 * breaking console.warn), and it compares outcome identifiers by EXACT equality
 * — `NotNotFoundException` and `SpecialFormatException` are forwarded, not
 * suppressed. The one widening this keeps is the plain `name` fallback: an
 * unrelated Error with `name` set to one of the three outcomes is suppressed.
 */
export function isExpectedZxingMiss(args: unknown[]): boolean {
  try {
    // Exactly the two operands of the upstream call. A third argument would be
    // data this filter has no contract for, so it is left visible instead.
    if (args.length !== 2) return false

    const [message, error] = args
    if (typeof message !== 'string' || !message.startsWith(MISS_MESSAGE_PREFIX)) return false
    if (!(error instanceof Error)) return false

    return outcomeIdentifiers(error).some((name) => EXPECTED_READER_OUTCOMES.includes(name))
  } catch {
    // Never let a broken operand turn a warning call into a thrown error.
    return false
  }
}

type Warn = typeof console.warn

let installedWrapper: Warn | null = null
let installedOriginal: Warn | null = null

/**
 * Install a `console.warn` wrapper that drops the expected miss above and
 * forwards every other call to the original with the same receiver and
 * arguments. Returns a restore function; calling it more than once is safe, and
 * calling this while already installed reuses the single wrapper instead of
 * stacking a second one.
 */
export function suppressExpectedZxingMisses(): () => void {
  if (installedWrapper && installedOriginal && console.warn === installedWrapper) {
    return createRestore(installedWrapper, installedOriginal)
  }

  const original = console.warn
  const wrapper = function (this: unknown, ...args: unknown[]) {
    if (isExpectedZxingMiss(args)) return
    original.apply(this, args)
  } as Warn

  try {
    console.warn = wrapper
  } catch {
    // A frozen/locked console must be left exactly as it was: return a no-op
    // restore rather than leave a half-installed wrapper behind.
    return () => {}
  }

  installedWrapper = wrapper
  installedOriginal = original
  return createRestore(wrapper, original)
}

function createRestore(wrapper: Warn, original: Warn): () => void {
  let restored = false
  return () => {
    if (restored) return
    restored = true
    // Only remove our own wrapper: never clobber one someone else installed on top.
    if (console.warn === wrapper) console.warn = original
    if (installedWrapper === wrapper) {
      installedWrapper = null
      installedOriginal = null
    }
  }
}
