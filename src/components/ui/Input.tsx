import type { InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

/**
 * In-house Input (design-system §7b). Token-driven, min touch target 44px.
 * `type` and every other native prop pass through; the global :focus-visible
 * rule supplies the accent ring.
 *
 * Font is 16px on purpose: iOS Safari auto-zooms into any focused input whose
 * computed font-size is under 16px, forcing the user to zoom back out after
 * typing. The 16px floor removes that whole class of annoyance.
 */
export default function Input({ type = 'text', className = '', ...rest }: InputProps) {
  return (
    <input
      type={type}
      className={`min-h-11 w-full rounded-sm border border-border bg-surface-raised px-3 text-base text-text-primary outline-none transition placeholder:text-text-muted ${className}`}
      {...rest}
    />
  )
}