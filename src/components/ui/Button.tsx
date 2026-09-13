/**
 * In-house Button (design-system §7b). Token-driven, never a bare hex.
 * Min touch target 44px, visible focus ring via the global :focus-visible rule.
 */
const VARIANTS = {
  // Primary action: accent background, contrast text.
  primary: 'bg-accent text-accent-contrast hover:opacity-90 active:opacity-95',
  // Secondary: raised surface with a border. Default for toolbar/actions.
  secondary:
    'border border-border bg-surface-raised text-text-primary hover:bg-surface active:bg-surface',
  // Quiet action: text only.
  ghost: 'text-text-secondary hover:bg-surface active:bg-surface',
}

const SIZES = {
  // 44px min height everywhere (design-system §7).
  md: 'min-h-11 px-4 text-sm',
  // Square icon button, also 44px.
  icon: 'h-11 w-11 p-0',
}

export default function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-sm font-medium transition disabled:pointer-events-none disabled:opacity-50 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
