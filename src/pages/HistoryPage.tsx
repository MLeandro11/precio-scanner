import { History } from 'lucide-react'
import { useParams } from 'react-router-dom'
import PlaceholderPage from './PlaceholderPage'

/**
 * Historial de precio del producto (identificado por su EAN). Necesita un
 * histórico de precios que hoy no existe en una sola tienda; el modelo ya lo
 * contempla (HistorialPrecio) para cuando llegue la fuente.
 */
export default function HistoryPage() {
  const { ean } = useParams<{ ean: string }>()
  return (
    <PlaceholderPage
      title={ean ? `Historial · ${ean}` : 'Historial de precio'}
      description="Acá vas a ver la evolución del precio de este producto. Requiere un histórico de precios que todavía no tenemos (hoy solo una tienda); está modelado para cuando llegue."
      icon={<History size={40} strokeWidth={1.5} aria-hidden="true" />}
    />
  )
}