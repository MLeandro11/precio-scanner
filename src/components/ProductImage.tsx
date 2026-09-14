import { useState } from 'react'
import { productImageSrc } from '../lib/images'

/**
 * A product photo from the Precios Claros CDN (by EAN), with a graceful fallback.
 *
 * Renders the real image when the EAN maps to one; if there is no usable EAN or
 * the CDN fails to load a code, it renders the provided `fallback` (a category
 * emoji). The `className` styles the box in both states (the fallback gets
 * centered; the image uses object-cover).
 */
export default function ProductImage({
  ean,
  alt = '',
  className = '',
  fallback,
}: {
  ean?: string
  alt?: string
  /** Box styling applied to both the image and the fallback container. */
  className?: string
  /** Shown while there is no image for the code or when it fails to load. */
  fallback: React.ReactNode
}) {
  const [failed, setFailed] = useState(false)
  const src = productImageSrc(ean)

  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center ${className}`}
        role="img"
        aria-label={alt}
      >
        {fallback}
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`object-cover ${className}`}
    />
  )
}