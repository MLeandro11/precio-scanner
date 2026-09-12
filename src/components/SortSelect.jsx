const SORTS = [
  { value: 'relevance', label: 'Relevancia' },
  { value: 'price-asc', label: 'Precio ↑' },
  { value: 'price-desc', label: 'Precio ↓' },
]

export default function SortSelect({ sort, onSortChange }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-600">
      Ordenar por
      <select
        value={sort}
        onChange={(e) => onSortChange(e.target.value)}
        className="rounded border border-slate-300 bg-white px-2 py-1 outline-none focus:border-slate-500"
      >
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  )
}
