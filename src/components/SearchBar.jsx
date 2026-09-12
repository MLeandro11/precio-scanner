export default function SearchBar({ query, onQueryChange }) {
  return (
    <div className="sticky top-0 z-10 -mx-4 bg-slate-50/95 px-4 py-3 backdrop-blur">
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Buscar productos…"
        aria-label="Buscar productos"
        autoFocus
        className="w-full rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-300"
      />
    </div>
  )
}
