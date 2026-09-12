import { ChevronDown } from 'lucide-react'

const SORTS = [
  { value: 'relevance', label: 'Relevancia' },
  { value: 'price-asc', label: 'Precio ↑' },
  { value: 'price-desc', label: 'Precio ↓' },
]

/**
 * Sort control (design-system §5): compact NATIVE select with a visible label.
 * No custom dropdown; tokens only. 44px min height for touch.
 */
export default function SortSelect({ sort, onSortChange, id = 'sort-select' }) {
  return (
    <label
      htmlFor={id}
      className="flex items-center gap-1.5 text-xs font-medium text-text-secondary"
    >
      Ordenar por
      <span className="relative inline-flex items-center">
        <select
          id={id}
          value={sort}
          onChange={(e) => onSortChange(e.target.value)}
          className="min-h-11 appearance-none rounded-sm border border-border bg-surface-raised py-2 pl-3 pr-8 text-sm text-text-primary outline-none transition"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute right-2 text-text-secondary"
        />
      </span>
    </label>
  )
}
