import { Search } from 'lucide-react'
import Input from './ui/Input.jsx'

/**
 * Search input (design-system §5). Pill, 44px min height, lucide Search icon.
 * The sticky positioning lives on the App header that wraps this field.
 */
export default function SearchBar({ query, onQueryChange }) {
  return (
    <div className="relative">
      <Search
        size={18}
        aria-hidden="true"
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-muted"
      />
      <Input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Buscar productos…"
        aria-label="Buscar productos"
        className="rounded-full pl-11 pr-4"
      />
    </div>
  )
}
