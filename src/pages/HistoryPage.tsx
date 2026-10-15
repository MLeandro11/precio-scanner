import { History } from 'lucide-react'
import { useParams } from 'react-router-dom'
import PlaceholderPage from './PlaceholderPage'

/**
 * Historial de precio del producto (identificado por su EAN). El dato ya existe: cada
 * corrida de la actualización commitea un snapshot diario del catálogo al branch `datos`
 * (una sola tienda). Lo que falta es esta pantalla, que todavía no lee esa serie; el
 * modelo (HistorialPrecio) la contempla.
 */
export default function HistoryPage() {
  const { ean } = useParams<{ ean: string }>()
  return (
    <PlaceholderPage
      title={ean ? `Historial · ${ean}` : 'Historial de precio'}
      description="Acá vas a ver la evolución del precio de este producto. El catálogo ya se guarda día por día desde octubre (una sola tienda), así que el historial existe; lo que falta es esta pantalla, que todavía no lo lee."
      icon={<History size={40} strokeWidth={1.5} aria-hidden="true" />}
    />
  )
}