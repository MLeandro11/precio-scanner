import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CameraOff,
  Check,
  ClipboardCheck,
  Flashlight,
  FlashlightOff,
  Plus,
  RotateCcw,
  ScanBarcode,
  Search,
  X,
} from 'lucide-react'
import Brand from '../components/Brand'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { useCatalog } from '../App'
import { useList } from '../hooks/useList'
import { useBarcodeScanner, vibrate } from '../hooks/useBarcodeScanner'
import ProductImage from '../components/ProductImage'
import { toLookupDigits } from '../lib/lupa/scan'
import { normalizeEan } from '../lib/lupa/list'
import type { Producto } from '../lib/types'

interface Detection {
  code: string
  product?: Producto
  loading: boolean
}

/**
 * Escáner de código de barras con cualquier dispositivo con cámara: decodifica
 * con ZXing (JS puro) en el navegador, sin depender de la API Chromium-only
 * BarcodeDetector.
 *
 * "Scanner inmersivo": cuando hay cámara, el video ocupa toda la pantalla detrás
 * de una barra superior, una ventana de escaneo con máscara y un dock contextual
 * no modal (la cámara sigue viva). La navegación inferior flota por encima.
 *
 * Cuando la cámara falta o se deniega, el video y la ventana desaparecen del
 * flujo: la pantalla queda compacta, con el ingreso manual del EAN como héroe
 * —documentado como el camino primario siempre disponible—.
 *
 * La raíz expone `data-scan-state` (el status del escáner) y, cuando hay una
 * detección, `data-scan-detected="1"`, para que la aceptación espere de forma
 * determinista en lugar de adivinar con sleeps.
 */
export default function ScanPage() {
  const navigate = useNavigate()
  const { client } = useCatalog()
  const { items, add, isInList } = useList()
  const [manual, setManual] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [detected, setDetected] = useState<Detection | null>(null)
  const [justAdded, setJustAdded] = useState<string | null>(null)

  const onDetect = (code: string) => {
    setDetected({ code, loading: true })
  }
  const scanner = useBarcodeScanner(onDetect)
  const status = scanner.status

  // Without a usable camera there is no live preview to frame: the immersive
  // scanner (full-bleed video + scan window) is removed entirely.
  const noCamera = status === 'denied' || status === 'unsupported' || status === 'error'

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
    vibrate(25)
    setJustAdded(key)
    setTimeout(() => setJustAdded(null), 1600)
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault()
    const q = manual.trim()
    if (!q) return
    navigate(`/buscar?q=${encodeURIComponent(q)}`)
  }

  const detectedKey = detected?.product ? detected.product.barcode || detected.product.id : null

  const manualForm = (hero: boolean) => (
    <form onSubmit={submitManual} className={hero ? '' : 'flex items-center gap-2'}>
      {hero ? (
        <div className="flex items-center gap-2">
          <Input
            type="text"
            inputMode="numeric"
            id="scan-manual-hero"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="7793940219009"
            aria-label="Código EAN"
            className="h-14 [&:focus]:border-accent"
          />
          <Button variant="primary" type="submit" disabled={!manual.trim()} className="h-14 shrink-0 px-5">
            Buscar
          </Button>
        </div>
      ) : (
        <>
          <Input
            type="text"
            inputMode="numeric"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="o escribí el EAN a mano…"
            aria-label="Código EAN"
            autoFocus
            className="[&:focus]:border-accent"
          />
          <Button variant="primary" type="submit" disabled={!manual.trim()} className="shrink-0">
            Buscar
          </Button>
        </>
      )}
    </form>
  )

  return (
    <main
      data-scan-state={status}
      data-scan-detected={detected ? '1' : undefined}
      className={
        noCamera
          ? 'safe-top mx-auto w-full max-w-lg px-4 pb-8'
          : 'relative min-h-dvh overflow-hidden bg-slate-950'
      }
    >
      {/* The <video> is always mounted so the scanner hook always has a live ref.
          Without a camera it is hidden and contributes no box to the layout. */}
      <video
        ref={scanner.videoRef}
        playsInline
        muted
        aria-hidden="true"
        className={noCamera ? 'hidden' : 'absolute inset-0 h-full w-full object-cover'}
      />

      {noCamera ? (
        // ------------------------------------------------------ no-camera state
        <>
          <Brand />

          <div className="mt-4 rounded-2xl border border-border bg-surface-raised p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-text-muted">
                <CameraOff size={20} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary">
                  {status === 'denied'
                    ? 'Permiso de cámara denegado'
                    : status === 'unsupported'
                      ? 'Este navegador no puede usar la cámara'
                      : 'La cámara no pudo arrancar'}
                </p>
                <p className="mt-1 text-xs text-text-secondary">
                  {status === 'denied'
                    ? 'Habilitá la cámara en el navegador y volvé a intentar, o escribí el EAN a mano.'
                    : status === 'unsupported'
                      ? 'Probá en Chrome, Edge, Safari o Firefox desde el celular, o escribí el EAN a mano.'
                      : scanner.error || 'Podés reintentar o escribir el EAN a mano.'}
                </p>
              </div>
            </div>
            <Button variant="secondary" className="mt-3 w-full" onClick={scanner.retry}>
              <RotateCcw size={18} aria-hidden="true" /> Volver a pedir permiso
            </Button>
          </div>

          {/* Manual EAN entry promoted to hero: the always-available fallback. */}
          <div className="mt-5">
            <label htmlFor="scan-manual-hero" className="text-sm font-semibold text-text-primary">
              Escribí el EAN
            </label>
            <div className="mt-2">{manualForm(true)}</div>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-text-secondary">
            <ScanBarcode size={14} aria-hidden="true" /> Un EAN tiene 13 dígitos; los separadores se ignoran.
          </p>

          <Button variant="secondary" className="mt-4 w-full" onClick={() => navigate('/')}>
            <Search size={18} aria-hidden="true" /> O buscá por nombre
          </Button>

          <button
            type="button"
            onClick={() => navigate('/lista')}
            className="mt-6 w-full rounded-2xl border border-border bg-surface-raised p-4 text-left text-sm text-text-secondary"
          >
            {items.length === 0
              ? 'Todavía no agregaste productos a tu lista.'
              : `Tenés ${items.length} producto${items.length === 1 ? '' : 's'} en tu lista.`}
          </button>
        </>
      ) : (
        // ------------------------------------------------------ immersive scanner
        <>
          {/* Top overlay bar: brand + list counter + torch (only when supported). */}
          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 pt-[calc(1rem+env(safe-area-inset-top,0px))]">
            <div className="flex items-center gap-2">
              <Search size={20} aria-hidden="true" strokeWidth={2.2} className="text-white drop-shadow" />
              <span className="text-lg font-bold leading-none text-white drop-shadow">Lupa</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate('/lista')}
                aria-label={`${items.length} producto${items.length === 1 ? '' : 's'} en tu lista`}
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full bg-black/40 px-3 text-sm font-semibold text-white backdrop-blur-sm"
              >
                <ClipboardCheck size={18} aria-hidden="true" />
                <span className="tnum">{items.length}</span>
              </button>
              {scanner.torch.supported ? (
                <button
                  type="button"
                  onClick={() => scanner.torch.toggle()}
                  aria-pressed={scanner.torch.on}
                  aria-label={scanner.torch.on ? 'Apagar la linterna' : 'Prender la linterna'}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm"
                >
                  {scanner.torch.on ? (
                    <FlashlightOff size={20} aria-hidden="true" />
                  ) : (
                    <Flashlight size={20} aria-hidden="true" />
                  )}
                </button>
              ) : null}
            </div>
          </div>

          {status === 'requesting' ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center px-6">
              <p role="status" className="rounded-full bg-black/60 px-4 py-2 text-center text-sm text-white">
                Pidiendo acceso a la cámara…
              </p>
            </div>
          ) : null}

          {status === 'active' ? (
            <>
              {/* Scan window: a true cutout — one element with a huge box-shadow mask. */}
              <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
                <div
                  data-scan-window
                  className="relative h-[190px] w-[80%] max-w-sm rounded-2xl border border-white/40 shadow-[0_0_0_9999px_rgba(2,6,23,0.6)]"
                >
                  <span className="absolute -left-0.5 -top-0.5 h-7 w-7 rounded-tl-lg border-l-4 border-t-4 border-white" />
                  <span className="absolute -right-0.5 -top-0.5 h-7 w-7 rounded-tr-lg border-r-4 border-t-4 border-white" />
                  <span className="absolute -bottom-0.5 -left-0.5 h-7 w-7 rounded-bl-lg border-b-4 border-l-4 border-white" />
                  <span className="absolute -bottom-0.5 -right-0.5 h-7 w-7 rounded-br-lg border-b-4 border-r-4 border-white" />
                </div>
                <p className="relative mt-5 rounded-full bg-black/50 px-4 py-1.5 text-center text-sm font-medium text-white">
                  Poné el código dentro del recuadro
                </p>
              </div>
            </>
          ) : null}

          {/* Bottom dock, above the nav. Non-modal: the camera keeps running. */}
          <div className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-lg px-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))]">
            {detected ? (
              <div className="rounded-2xl bg-surface-raised p-3 shadow-xl">
                <div className="flex items-start gap-3">
                  {detected.loading ? (
                    <div className="skeleton h-14 w-14 shrink-0 rounded-xl" />
                  ) : (
                    <ProductImage
                      ean={detected.product?.barcode}
                      alt={detected.product?.nombre ?? ''}
                      className="h-14 w-14 shrink-0 rounded-xl bg-surface object-cover"
                      fallback={
                        <span className="text-2xl" aria-hidden="true">
                          🧺
                        </span>
                      }
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[11px] text-text-muted">{detected.code}</p>
                    {detected.loading ? (
                      <p className="mt-1 text-sm text-text-secondary">Buscando en el catálogo…</p>
                    ) : detected.product ? (
                      <>
                        <p className="mt-0.5 line-clamp-2 text-sm font-semibold text-text-primary">
                          {detected.product.nombre}
                        </p>
                        <p className="tnum text-sm text-text-secondary">
                          $ {detected.product.precio.toLocaleString('es-AR')}
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 text-xs text-text-secondary">
                        No encontramos ese código. Probá de nuevo o buscá por nombre.
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label="Descartar"
                    onClick={() => setDetected(null)}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-surface"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
                {detected.product ? (
                  <Button
                    variant="primary"
                    className="mt-3 w-full"
                    onClick={addDetected}
                    disabled={justAdded === detectedKey}
                  >
                    {justAdded === detectedKey ? (
                      <>
                        <Check size={18} aria-hidden="true" /> En tu lista
                      </>
                    ) : (
                      <>
                        <Check size={18} aria-hidden="true" />
                        {isInList(detectedKey ?? '') ? 'Ya está — sumar otro' : 'Agregar y seguir'}
                        <Plus size={18} aria-hidden="true" />
                      </>
                    )}
                  </Button>
                ) : null}
                {!manualOpen ? (
                  <button
                    type="button"
                    onClick={() => setManualOpen(true)}
                    className="mt-2 w-full rounded-sm py-1 text-center text-xs font-medium text-text-secondary"
                  >
                    Escribí el EAN a mano
                  </button>
                ) : null}
              </div>
            ) : null}

            {manualOpen ? (
              <div className="mt-2 rounded-2xl bg-surface-raised p-3 shadow-xl">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-text-primary">Escribí el EAN a mano</p>
                  <button
                    type="button"
                    aria-label="Cerrar ingreso manual"
                    onClick={() => setManualOpen(false)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
                <div className="mt-2">{manualForm(false)}</div>
              </div>
            ) : !detected ? (
              <Button variant="secondary" className="w-full shadow-xl" onClick={() => setManualOpen(true)}>
                <ScanBarcode size={18} aria-hidden="true" /> Escribí el EAN a mano
              </Button>
            ) : null}
          </div>
        </>
      )}
    </main>
  )
}
