import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, LineChart, TriangleAlert } from 'lucide-react'
import Brand from '../components/Brand'
import Button from '../components/ui/Button'
import { useCatalog } from '../App'
import { useResolveEans } from '../hooks/useResolveEans'
import { loadHistorial, precioDeHoy, serieDe, variacionDe } from '../lib/historial'
import type { HistorialArtifact, HistorialDia, HistorialLoadResult, PuntoSerie } from '../lib/historial'
import { normalizeEan } from '../lib/lupa/list'

/**
 * Historial de precio de un producto (`/historial/:ean`).
 *
 * La serie se **reconstruye con el log** (`data/historial.json`), no con los
 * snapshots: cada fila del log es un punto, y como un precio que no cambió conserva
 * el valor de su último cambio, la última fila es también el precio de hoy. Por eso
 * esta pantalla **no depende del catálogo para dibujar**: el nombre del producto es
 * una comodidad, la serie no.
 *
 * Honestidad de los estados (la misma ley que `/cambios`): `absent` es "todavía no
 * hay historial publicado" —el pipeline lo publica recién en su próxima corrida—,
 * `invalid` es "lo publicado no es legible", y no son lo mismo. Un tramo sin datos
 * se nombra; nunca se dibuja continuidad sobre un hueco.
 *
 * Ganchos estables para la aceptación, con la convención de `/cambios`:
 *   - `data-history-state` en la raíz: loading | ready | cached | absent | invalid | offline | error
 *   - `data-history-points` (cantidad de puntos) y `data-history-point` por punto
 *   - `data-history-move` por movimiento listado
 *   - `data-history-gap` por tramo sin datos
 */

const COPY = {
  titulo: 'Historial de precio',
  sinEan: 'El código del producto no es válido.',
  actualizado: (fecha: string) => `Última actualización de los datos: ${fecha}.`,
  sinHistorial:
    'Todavía no hay historial publicado. El catálogo se guarda día por día y esta pantalla se llena con la próxima actualización.',
  ilegible: 'El historial publicado no se pudo leer.',
  offline: 'No hay conexión y todavía no hay una copia guardada del historial.',
  error: 'No pudimos traer el historial ahora.',
  reintentar: 'Reintentar',
  ultimoPrecio: 'Último precio registrado',
  sinPuntos: 'Todavía no hay historial para este producto.',
  unPunto: 'Todavía hay un solo día registrado para este producto.',
  sinCambios: (dias: number) => `Sin cambios en los últimos ${dias} días registrados.`,
  hueco: (desde: string, hasta: string) =>
    desde === hasta ? `Sin datos del ${desde}.` : `Sin datos del ${desde} al ${hasta}.`,
  movimientos: 'Movimientos',
  sinMovimientos: 'Este producto no cambió de precio en los días registrados.',
  precio: (valor: number) => `$ ${valor.toLocaleString('es-AR')}`,
}

/** `YYYY-MM-DD` → "20 de octubre". Sin zona horaria: la fecha es el bucket, no un instante. */
function fechaLarga(fecha: string): string {
  const date = new Date(`${fecha}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return fecha
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

function fechaCorta(fecha: string): string {
  const date = new Date(`${fecha}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return fecha
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/**
 * Magnitud porcentual, sin signo: cuando al lado hay una flecha, el signo sería una
 * segunda dirección que puede contradecir a la primera (`↓ +3,33 %`).
 */
function pctMagnitud(valor: number | null): string {
  if (valor === null) return '—'
  const absoluto = Math.abs(valor)
  if (absoluto !== 0 && absoluto < 0.005) return '<0,01 %'
  return `${absoluto.toLocaleString('es-AR', { maximumFractionDigits: 2, useGrouping: false })} %`
}

/**
 * Un tramo de la línea. Se corta en cada hueco: un segmento que cruza días sin dato
 * afirmaría una continuidad que el archivo no tiene.
 */
function tramos(puntos: PuntoSerie[], huecos: Array<{ desde: string; hasta: string }>): PuntoSerie[][] {
  // El corte va entre los dos puntos que el hueco separa: el rango del hueco son los
  // días SIN dato, no una fecha de la serie.
  const corta = (a: PuntoSerie, b: PuntoSerie) =>
    huecos.some((h) => h.desde > a.fecha && h.hasta < b.fecha)
  const salida: PuntoSerie[][] = []
  let actual: PuntoSerie[] = []
  for (let i = 0; i < puntos.length; i++) {
    const punto = puntos[i]!
    if (i > 0 && corta(puntos[i - 1]!, punto) && actual.length > 0) {
      salida.push(actual)
      actual = []
    }
    actual.push(punto)
  }
  if (actual.length > 0) salida.push(actual)
  return salida
}

/** Gráfico de línea en SVG a mano: sin dependencias y con los tokens del tema. */
export function SerieChart({ puntos, huecos }: { puntos: PuntoSerie[]; huecos: Array<{ desde: string; hasta: string }> }) {
  const W = 320
  const H = 96
  const PAD = 6
  if (puntos.length === 0) return null

  const dias = puntos.map((p) => Math.floor(Date.parse(`${p.fecha}T00:00:00Z`) / 86_400_000))
  const precios = puntos.map((p) => p.precio)
  const minDia = Math.min(...dias)
  const maxDia = Math.max(...dias)
  const minPrecio = Math.min(...precios)
  const maxPrecio = Math.max(...precios)
  // Un solo punto, o precios idénticos: la serie es una recta, y una recta al medio
  // del gráfico es honesta (no hay forma de exagerar una variación que no existe).
  const spanDia = Math.max(1, maxDia - minDia)
  const spanPrecio = Math.max(1, maxPrecio - minPrecio)

  const x = (fecha: string) =>
    PAD + ((Math.floor(Date.parse(`${fecha}T00:00:00Z`) / 86_400_000) - minDia) / spanDia) * (W - 2 * PAD)
  const y = (precio: number) =>
    PAD + (1 - (precio - minPrecio) / spanPrecio) * (H - 2 * PAD)

  const primero = puntos[0]!.precio
  const ultimo = puntos[puntos.length - 1]!.precio
  const color = ultimo < primero ? 'text-price-green' : ultimo > primero ? 'text-danger' : 'text-text-secondary'

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={`mt-2 h-[96px] w-full ${color}`}
      role="img"
      aria-label={`Serie de precio: ${puntos.length} punto(s), de ${COPY.precio(primero)} a ${COPY.precio(ultimo)}`}
    >
      {/* Solo los tramos con dos o más puntos son una línea. Un punto suelto se
          dibuja abajo, con los demás: repetirlo acá duplicaría el nodo. */}
      {tramos(puntos, huecos)
        .filter((tramo) => tramo.length > 1)
        .map((tramo, i) => (
          <polyline
            key={`tramo-${i}`}
            data-history-segment={i}
            points={tramo.map((p) => `${x(p.fecha)},${y(p.precio)}`).join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      {puntos.map((p) => (
        <g key={`dot-${p.fecha}`} data-history-point={p.fecha}>
          {/* Un tramo de un solo punto no puede tener línea, pero un punto solo se lee
              como una mancha: el guion dice "acá hay un nivel", sin afirmar vecinos. */}
          <line
            x1={x(p.fecha) - 5}
            y1={y(p.precio)}
            x2={x(p.fecha) + 5}
            y2={y(p.precio)}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          />
          <circle cx={x(p.fecha)} cy={y(p.precio)} r={2.5} fill="currentColor" />
        </g>
      ))}
    </svg>
  )
}

/** Los días en que el precio cambió, del más nuevo al más viejo, con la variación de cada salto. */
function Movimientos({ puntos }: { puntos: PuntoSerie[] }) {
  if (puntos.length < 2) {
    return <p className="mt-2 text-sm text-text-secondary">{COPY.sinMovimientos}</p>
  }
  const filas = puntos
    .map((punto, i) => {
      const previo = i > 0 ? puntos[i - 1]! : null
      const delta = previo ? punto.precio - previo.precio : null
      const relativa = previo && previo.precio !== 0 ? (delta! / previo.precio) * 100 : null
      return { punto, delta, relativa }
    })
    .slice(1)
    .filter((fila) => fila.delta !== 0)
    .reverse()

  return (
    <ul className="mt-2 divide-y divide-border">
      {filas.map(({ punto, delta, relativa }) => (
        <li
          key={punto.fecha}
          data-history-move={punto.fecha}
          className="flex items-baseline justify-between gap-3 py-2"
        >
          <span className="text-sm text-text-secondary">{fechaLarga(punto.fecha)}</span>
          <span className="tnum text-sm font-semibold text-text-primary">{COPY.precio(punto.precio)}</span>
          <span
            className={`tnum w-20 text-right text-xs font-semibold ${
              delta === null || delta === 0
                ? 'text-text-secondary'
                : delta < 0
                  ? 'text-price-green'
                  : 'text-danger'
            }`}
          >
            {delta === null || delta === 0
              ? '—'
              : `${delta < 0 ? '↓' : '↑'} ${pctMagnitud(relativa)}`}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** El estado de la pantalla: el del loader más el "todavía estoy pidiendo". */
export type HistorialEstado = HistorialLoadResult | { status: 'loading' }

/**
 * La fecha del punto que cierra la serie.
 *
 * `HistoryView` no recibe un reloj ni lo consulta: la última lectura del catálogo es
 * la corrida que el artefacto declara en `generado`, y esa fecha es la del punto de
 * hoy. Así la vista se ve igual para todos los husos horarios y para cualquier
 * lector, que es lo que un bucket `YYYY-MM-DD` significa. Si el artefacto no trajera
 * una fecha legible -el loader ya la valida, así que es defensivo-, cae al día más
 * nuevo del propio log.
 */
function fechaDeLectura(artifact: HistorialArtifact): string {
  const generado = artifact.generado.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(generado) && !Number.isNaN(Date.parse(`${generado}T00:00:00Z`))) {
    return generado
  }
  return artifact.dias.reduce((nuevo, dia) => (dia.fecha > nuevo ? dia.fecha : nuevo), '')
}

export interface HistoryViewProps {
  ean: string
  estado: HistorialEstado
  nombre?: string
  /** El precio de hoy del catálogo (`precioDeHoy`), que cierra la serie. */
  precioHoy?: number | null
  onRetry?: () => void
}

/** La vista pura: recibe un resultado del loader y no sabe de red, rutas ni catálogo. */
export function HistoryView({ ean, estado, nombre, precioHoy = null, onRetry }: HistoryViewProps) {
  const navigate = useNavigate()
  const dias: HistorialDia[] = estado.status === 'ready' ? estado.artifact.dias : []
  // El precio de hoy es la última lectura del catálogo: sin él, un producto que
  // existe pero todavía no cambió de precio no tenía ningún punto que dibujar.
  const hoy = estado.status === 'ready' ? fechaDeLectura(estado.artifact) : ''
  const serie = serieDe(ean, dias, precioHoy, hoy)
  const variacion = variacionDe(serie.puntos)
  const ultimo = serie.puntos[serie.puntos.length - 1]

  const stateAttr = estado.status === 'ready' && estado.source === 'cache' ? 'cached' : estado.status

  return (
    <main className="safe-top mx-auto w-full max-w-lg px-4 pb-8" data-history-state={stateAttr}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Volver"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-text-secondary transition hover:bg-surface"
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <Brand />
      </div>

      {/* `Brand` ya aporta el único `<h1>` de la página: el nombre del producto es un
          subtítulo, no un segundo título de nivel 1. */}
      <h2 className="mt-4 text-xl font-bold text-text-primary">{nombre ?? COPY.titulo}</h2>
      <p className="font-mono text-xs text-text-secondary">{ean}</p>

      {estado.status === 'loading' ? (
        <p role="status" className="mt-6 text-sm text-text-secondary">
          Buscando el historial…
        </p>
      ) : null}

      {estado.status === 'absent' ? (
        <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-4">
          <p className="flex items-start gap-2 text-sm text-text-secondary">
            <LineChart size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
            {COPY.sinHistorial}
          </p>
        </div>
      ) : null}

      {estado.status === 'invalid' || estado.status === 'offline' || estado.status === 'error' ? (
        <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-4">
          <p className="flex items-start gap-2 text-sm text-text-secondary">
            <TriangleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
            {estado.status === 'invalid' ? COPY.ilegible : estado.status === 'offline' ? COPY.offline : COPY.error}
          </p>
          {onRetry && estado.status !== 'invalid' ? (
            <Button variant="secondary" className="mt-3 w-full" onClick={onRetry}>
              {COPY.reintentar}
            </Button>
          ) : null}
        </div>
      ) : null}

      {estado.status === 'ready' ? (
        <>
          <div className="mt-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-text-secondary">{COPY.ultimoPrecio}</p>
              <p className="tnum text-2xl font-bold text-text-primary">
                {ultimo ? COPY.precio(ultimo.precio) : '—'}
              </p>
              {/* Un estado por renglón: 0 puntos no es "un solo día" —no hay ningún
                  día— y no puede repetir la frase de "no cambió de precio". */}
              <p className="text-xs text-text-secondary">
                {serie.puntos.length === 0
                  ? COPY.sinPuntos
                  : variacion === null
                    ? COPY.unPunto
                    : variacion.absoluta === 0
                      ? COPY.sinCambios(serie.puntos.length)
                      : `${variacion.absoluta < 0 ? '↓' : '↑'} ${pctMagnitud(
                          variacion.pct,
                        )} desde ${fechaCorta(serie.puntos[0]!.fecha)}`}
              </p>
            </div>
          </div>

          <div data-history-points={serie.puntos.length}>
            <SerieChart puntos={serie.puntos} huecos={serie.huecos} />
          </div>

          {serie.puntos.length > 0 ? (
            <p className="mt-1 flex justify-between text-[11px] text-text-secondary">
              <span>{fechaCorta(serie.puntos[0]!.fecha)}</span>
              <span>{fechaCorta(ultimo!.fecha)}</span>
            </p>
          ) : null}

          {serie.huecos.map((h) => (
            <p
              key={`${h.desde}-${h.hasta}`}
              data-history-gap={`${h.desde}..${h.hasta}`}
              className="mt-2 text-xs text-text-secondary"
            >
              {COPY.hueco(fechaCorta(h.desde), fechaCorta(h.hasta))}
            </p>
          ))}

          {/* Con 0 puntos no hay movimientos que listar: el estado ya lo dice arriba,
              y la lista vacía repetiría la misma frase una segunda vez. */}
          {serie.puntos.length > 0 ? (
            <>
              <h2 className="mt-6 text-sm font-semibold text-text-primary">{COPY.movimientos}</h2>
              <Movimientos puntos={serie.puntos} />
            </>
          ) : null}

          <p className="mt-6 text-xs text-text-secondary">{COPY.actualizado(fechaLarga(estado.artifact.generado.slice(0, 10)))}</p>
        </>
      ) : null}
    </main>
  )
}

export default function HistoryPage() {
  const { ean } = useParams<{ ean: string }>()
  const { client } = useCatalog()
  const codigo = normalizeEan(ean ?? '')
  const [estado, setEstado] = useState<HistorialEstado>({ status: 'loading' })
  const [intento, setIntento] = useState(0)
  // La identidad importa: `useResolveEans` memoiza y reinicia su efecto por el array
  // de EANs. Un literal acá (`[codigo]`) es un array nuevo en cada render, el efecto
  // vuelve a correr, `setResolved({})` re-renderiza y se arma un loop infinito que
  // consulta al worker una vez por vuelta.
  const eans = useMemo(() => (codigo ? [codigo] : []), [codigo])
  const productos = useResolveEans(client, eans)
  const nombre = productos[0]?.nombre
  // "La última lectura del catálogo": la última fila del arreglo para este EAN, la
  // misma regla con la que el log escribe cada día. Sin esto el punto de hoy era
  // código muerto y un producto sin filas en el log se dibujaba en cero.
  const precioHoy = precioDeHoy(productos, codigo)

  useEffect(() => {
    if (!codigo) return
    let cancelado = false
    setEstado({ status: 'loading' })
    loadHistorial()
      .then((resultado) => {
        if (!cancelado) setEstado(resultado)
      })
      .catch(() => {
        if (!cancelado) setEstado({ status: 'error' })
      })
    return () => {
      cancelado = true
    }
  }, [codigo, intento])

  if (!codigo) {
    return (
      <main className="safe-top mx-auto w-full max-w-lg px-4 pb-8" data-history-state="invalid">
        <Brand />
        <p className="mt-6 flex items-start gap-2 text-sm text-text-secondary">
          <TriangleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
          {COPY.sinEan}
        </p>
        <Link
          to="/"
          className="mt-4 inline-flex h-11 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold text-text-primary"
        >
          Volver al inicio
        </Link>
      </main>
    )
  }

  return (
    <HistoryView
      ean={codigo}
      estado={estado}
      nombre={nombre}
      precioHoy={precioHoy}
      onRetry={() => setIntento((n) => n + 1)}
    />
  )
}
