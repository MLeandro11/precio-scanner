import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Plus, ScanBarcode } from 'lucide-react'
import Brand from '../components/Brand'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { useCatalog } from '../App'
import { useList } from '../hooks/useList'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import type { ScanStatus } from '../hooks/useBarcodeScanner'
import { toLookupDigits } from '../lib/lupa/scan'
import { normalizeEan } from '../lib/lupa/list'
import type { Producto } from '../lib/types'

interface Detection {
  code: string
  product?: Producto
  loading: boolean
}

/**
 * Escáner de código de barras. Con cámara (BarcodeDetector, Chromium) detecta
 * el EAN y lo agrega a la lista; en navegadores sin soporte o con permiso
 * denegado, el ingreso manual sigue disponible y es el camino primario.
 */
export default function ScanPage() {
  const navigate = useNavigate()
  const { client } = useCatalog()
  const { add, isInList } = useList()
  const [manual, setManual] = useState('')
  const [detected, setDetected] = useState<Detection | null>(null)
  const [justAdded, setJustAdded] = useState<string | null>(null)

  const onDetect = (code: string) => {
    setDetected({ code, loading: true })
  }
  const scanner = useBarcodeScanner(onDetect)

  // Resolve a detected code to its product via the worker's exact lookup.
  useEffect(() => {
    if (!detected || detected.product || !detected.loading) return
    let alive = true
    const digits = toLookupDigits(detected.code)
    if (digits.length < 6) {
      setDetected((d) => (d ? { ...d, loading: false } : d))
      return
    }
    client.query({ query: digits, limit: 30 }).then((r) => {
      if (!alive) return
      const product = r.results.find(
        (p) => normalizeEan(p.barcode).replace(/\D/g, '') === digits,
      )
      setDetected((d) => (d ? { ...d, product, loading: false } : d))
    })
    return () => {
      alive = false
    }
  }, [detected, client])

  function addDetected() {
    if (!detected?.product) return
    const key = detected.product.barcode || detected.product.id
    add(key, detected.product.nombre)
    setJustAdded(key)
    setTimeout(() => setJustAdded(null), 1600)
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault()
    const q = manual.trim()
    if (!q) return
    navigate(`/buscar?q=${encodeURIComponent(q)}`)
  }

  const showCamera =
    scanner.status === 'requesting' ||
    scanner.status === 'active' ||
    scanner.status === 'error'

  return (
    <main className="safe-top mx-auto w-full max-w-lg px-4 pb-8">
      <Brand />

      {/* Camera viewport */}
      {showCamera ? (
      <div className="relative mt-5 overflow-hidden rounded-2xl bg-slate-900">
        <div className="aspect-[3/4] w-full">
          <video
            ref={scanner.videoRef}
            playsInline
            muted
            className="absolute inset-0 h-full w-full object-cover"
            aria-hidden="true"
          />
          {scanner.status === 'requesting' ? (
            <p className="absolute inset-0 flex items-center justify-center text-xs text-white/80" role="status">
              Pidiendo acceso a la cámara…
            </p>
          ) : null}
          {scanner.status === 'error' ? (
            <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-white/80">
              La cámara no pudo arrancar.
            </p>
          ) : null}
          {scanner.status === 'active' ? (
            <>
              {/* corners */}
              <div className="pointer-events-none absolute left-3 top-3 h-10 w-10 rounded-tl-lg border-l-2 border-t-2 border-accent" />
              <div className="pointer-events-none absolute right-3 top-3 h-10 w-10 rounded-tr-lg border-r-2 border-t-2 border-accent" />
              <div className="pointer-events-none absolute bottom-3 left-3 h-10 w-10 rounded-bl-lg border-b-2 border-l-2 border-accent" />
              <div className="pointer-events-none absolute bottom-3 right-3 h-10 w-10 rounded-br-lg border-b-2 border-r-2 border-accent" />
              {/* scan line */}
              <div className="pointer-events-none absolute left-6 right-6 top-1/2 h-0.5 animate-pulse bg-accent shadow-[0_0_10px_2px_rgba(22,163,74,.5)]" />
              <p className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-xs text-white/90">
                Apuntá al código de barras
              </p>
            </>
          ) : null}
        </div>
      </div>
      ) : null}

      {/* Camera status feedback */}
      {scanner.status === 'requesting' ? (
        <p className="mt-3 text-center text-xs text-text-secondary" role="status">
          Pidiendo acceso a la cámara…
        </p>
      ) : null}
      {scanner.status === 'unsupported' ? (
        <p className="mt-3 rounded-xl border border-border bg-surface-raised px-4 py-3 text-xs text-text-secondary">
          <b className="text-text-primary">Sin cámara en este navegador.</b> Abrí Lupa en
          Chrome/Edge (o desde el celular instalado) para escanear con la cámara. Por ahora,
          escribí el EAN abajo.
        </p>
      ) : null}
      {scanner.status === 'denied' ? (
        <p className="mt-3 rounded-xl border border-border bg-surface-raised px-4 py-3 text-xs text-text-secondary">
          <b className="text-text-primary">Permiso de cámara denegado.</b> Podés escribirlo a mano
          abajo, o habilitar la cámara en el navegador.
        </p>
      ) : null}
      {scanner.status === 'error' ? (
        <p className="mt-3 rounded-xl border border-border bg-surface-raised px-4 py-3 text-xs text-text-secondary">
          La cámara no pudo arrancar. Escribí el EAN a mano abajo.
        </p>
      ) : null}

      {/* Detected product */}
      {detected ? (
        <div className="mt-4 rounded-2xl border border-accent/50 bg-surface-raised p-4">
          <p className="text-xs font-semibold text-accent">✓ EAN detectado</p>
          <p className="mt-1 break-all font-mono text-xs text-text-muted">
            {detected.code}
          </p>

          {detected.loading ? (
            <p className="mt-2 text-xs text-text-secondary">Buscando en el catálogo…</p>
          ) : detected.product ? (
            <>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface text-2xl">
                  🧺
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-text-primary">
                    {detected.product.nombre}
                  </p>
                  <p className="tnum text-xs text-text-secondary">
                    $ {detected.product.precio.toLocaleString('es-AR')}
                  </p>
                </div>
              </div>
              <Button
                variant="primary"
                className="mt-3 w-full"
                onClick={addDetected}
                disabled={justAdded === (detected.product.barcode || detected.product.id)}
              >
                {justAdded === (detected.product.barcode || detected.product.id) ? (
                  <>
                    <Check size={18} aria-hidden="true" /> En tu lista
                  </>
                ) : isInList(detected.product.barcode || detected.product.id) ? (
                  <>
                    <Check size={18} aria-hidden="true" /> Ya está — sumar otro
                  </>
                ) : (
                  <>
                    <Plus size={18} aria-hidden="true" /> Agregar a mi lista
                  </>
                )}
              </Button>
            </>
          ) : (
            <p className="mt-2 text-xs text-text-secondary">
              No encontramos ese código en el catálogo actual. Probá de nuevo o buscá por nombre.
            </p>
          )}
        </div>
      ) : null}

      {/* Manual EAN entry (always available) */}
      <form onSubmit={submitManual} className="mt-4 flex items-center gap-2">
        <Input
          type="text"
          inputMode="numeric"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="o escribí el EAN a mano…"
          aria-label="Código EAN"
          className="[&:focus]:border-accent"
        />
        <Button variant="primary" type="submit" disabled={!manual.trim()} className="shrink-0">
          Buscar
        </Button>
      </form>

      <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-text-secondary">
        <ScanBarcode size={14} aria-hidden="true" /> Un EAN tiene 13 dígitos; los separadores se ignoran.
      </p>
    </main>
  )
}