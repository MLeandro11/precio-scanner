/**
 * Lupa brand lockup: the symbol (the "L", optionally with its barcode) plus the
 * "LUPA" wordmark, composed into ONE self-contained <svg>.
 *
 * The geometry is inlined from the brand assets instead of shipped as .svg files so
 * the mark inherits `currentColor` (semantic tokens) and flips with the theme, with
 * no extra network request and no new dependency.
 *
 * The caller only picks a `variant` and a `height`; every other dimension is derived
 * here. Both groups are normalized to their OWN viewBoxes, so each one needs its
 * scale() (and the wordmark its translate()) — without them the artwork renders
 * off-canvas.
 */

/** Symbol boxes: `boxHeight` is the source viewBox height, `aspect` its width/height. */
const SYMBOL = {
  lite: { boxHeight: 320, aspect: 288 / 320 },
  full: { boxHeight: 448, aspect: 320 / 448 },
} as const

export type LupaLockupVariant = keyof typeof SYMBOL

/** The wordmark viewBox is 3588.77 × 1000: the cap height is the full 1000 units. */
const WORDMARK_BOX_HEIGHT = 1000
const WORDMARK_ASPECT = 3.58877

/** The wordmark sits at 60% of the symbol height, so the symbol keeps the weight. */
const WORDMARK_CAP_RATIO = 0.6

/** Box lengths keep 3 decimals: sub-pixel accurate and readable in the markup. */
function len(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** Scale factors keep 5 so a scaled group lands exactly inside its derived box. */
function factor(value: number): number {
  return Math.round(value * 1e5) / 1e5
}

/** The L symbol. `lite` is the L alone; `full` adds the barcode underneath. */
function Symbol({ variant }: { variant: LupaLockupVariant }) {
  return (
    <g fill="currentColor">
      {/* The source paths are pushed by the asset's own translate(); keep it so the
          geometry stays byte-for-byte comparable with the design files. */}
      <g transform={variant === 'lite' ? 'translate(-112 -32)' : 'translate(-96 -32)'}>
        <path d="M112 32H208V256H400V352H112Z" />
        {variant === 'full' ? (
          <>
            <rect x="96" y="384" width="32" height="96" />
            <rect x="144" y="384" width="16" height="96" />
            <rect x="176" y="384" width="48" height="96" />
            <rect x="240" y="384" width="16" height="96" />
            <rect x="272" y="384" width="32" height="96" />
            <rect x="336" y="384" width="16" height="96" />
            <rect x="368" y="384" width="48" height="96" />
          </>
        ) : null}
      </g>
    </g>
  )
}

/** The "LUPA" wordmark, already converted to curves. */
function Wordmark() {
  return (
    <g fill="currentColor">
      <path
        transform="translate(0.000 1000.000) scale(0.671141 -0.671141)"
        d="M96.3193359375 0V1490H455.681640625V305.921875H1115.9208984375V0Z"
      />
      <path
        transform="translate(760.687 1000.000) scale(0.671141 -0.671141)"
        d="M721.52001953125 -24Q531.5225577039437 -24 390.66105912540934 44.6199951171875Q249.799560546875 113.239990234375 172.0994873046875 236.7346955510496Q94.3994140625 360.2294008677242 94.3994140625 524.240234375V1490H444.6416015625V553.4404296875Q444.6416015625 474.88826556797443 479.721435546875 413.80485055742474Q514.80126953125 352.721435546875 576.9466273716519 317.5216064453125Q639.0919852120536 282.32177734375 721.9057338169642 282.32177734375Q804.719482421875 282.32177734375 866.8108037218285 317.3716395853137Q928.902125021782 352.4215018268774 963.650281260891 413.2511561868762Q998.3984375 474.080810546875 998.3984375 553.4404296875V1490H1348.640625V524.3749174735915Q1348.640625 359.840087890625 1271.064476026315 236.3574993799603Q1193.4883270526302 112.87491086929563 1052.572803070541 44.437455434647816Q911.657279088452 -24 721.52001953125 -24Z"
      />
      <path
        transform="translate(1712.650 1000.000) scale(0.671141 -0.671141)"
        d="M96.3193359375 0V1490H705.560302734375Q878.280517578125 1490 1004.3206787109375 1428.5399169921875Q1130.36083984375 1367.079833984375 1198.700927734375 1254.1796875Q1267.041015625 1141.279541015625 1267.041015625 986.3193359375Q1267.041015625 832.119140625 1198.220947265625 718.8389892578125Q1129.40087890625 605.558837890625 1002.8807373046875 543.978759765625Q876.360595703125 482.398681640625 703.640380859375 482.398681640625H299.560791015625V780.720458984375H680.56005859375Q753.399658203125 780.720458984375 805.859375 805.9603271484375Q858.319091796875 831.2001953125 887.0389404296875 877.43994140625Q915.7587890625 923.6796875 915.7587890625 986.3193359375Q915.7587890625 1049.958984375 887.0389404296875 1095.5787353515625Q858.319091796875 1141.198486328125 805.859375 1166.4383544921875Q753.399658203125 1191.67822265625 680.56005859375 1191.67822265625H455.681640625V0Z"
      />
      <path
        transform="translate(2574.679 1000.000) scale(0.671141 -0.671141)"
        d="M4.7998046875 0 516.79931640625 1490H991.36279296875L1505.722412109375 0H1103.959716796875L901.921142578125 654.796875Q853.44091796875 819.037841796875 805.4407958984375 985.978515625Q757.440673828125 1152.919189453125 706.80078125 1348.039306640625H804.4013671875Q752.241455078125 1152.919189453125 703.4813232421875 985.978515625Q654.72119140625 819.037841796875 604.48095703125 654.796875L395.722412109375 0ZM356.440673828125 286.518310546875V568.119873046875H1154.841552734375V286.518310546875Z"
      />
    </g>
  )
}

/**
 * One inline `<svg>` composing the symbol and the wordmark.
 *
 * @param variant  `lite` = the L alone (tight spaces), `full` = L + barcode (hero use)
 * @param height   rendered height of the SYMBOL in px; drives every other dimension
 * @param gap      px between the symbol and the wordmark
 * @param title    accessible name (also used as the `<title>` text)
 * @param className extra classes for the svg, e.g. a colour token or a drop shadow
 * @param decorative render as a decorative image (no accessible name) for callers
 *                   that already announce "Lupa" elsewhere, so screen readers do
 *                   not read the brand twice
 */
export default function LupaLockup({
  variant = 'lite',
  height,
  gap,
  title = 'Lupa',
  className,
  decorative = false,
}: {
  variant?: LupaLockupVariant
  height: number
  gap: number
  title?: string
  className?: string
  decorative?: boolean
}) {
  const symbol = SYMBOL[variant]
  const symbolWidth = height * symbol.aspect
  const capHeight = height * WORDMARK_CAP_RATIO
  const wordmarkWidth = capHeight * WORDMARK_ASPECT
  const totalWidth = symbolWidth + gap + wordmarkWidth

  return (
    <svg
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative ? true : undefined}
      width={len(totalWidth)}
      height={height}
      viewBox={`0 0 ${len(totalWidth)} ${height}`}
      className={className}
    >
      {decorative ? null : <title>{title}</title>}
      {/* Normalized to the symbol's own box: scaled up to `height`. */}
      <g transform={`scale(${factor(height / symbol.boxHeight)})`}>
        <Symbol variant={variant} />
      </g>
      {/* Normalized to the wordmark's 1000-unit cap height, then placed after the gap. */}
      <g
        transform={`translate(${len(symbolWidth + gap)} 0) scale(${factor(
          capHeight / WORDMARK_BOX_HEIGHT,
        )})`}
      >
        <Wordmark />
      </g>
    </svg>
  )
}
