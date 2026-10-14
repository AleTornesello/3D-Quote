const MAX_SIDE_PX = 800

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** react-pdf can't draw SVG images, so an SVG is drawn on a canvas and exported as PNG. */
async function rasteriseSvg(svg: Blob): Promise<string> {
  const url = URL.createObjectURL(svg)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const scale = Math.min(1, MAX_SIDE_PX / Math.max(image.naturalWidth, image.naturalHeight, 1))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no canvas')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Fetches the logo at `url` and returns a PNG or JPEG data URL; rejects when that isn't possible. */
export async function loadLogoDataUrl(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`logo ${response.status}`)
  const blob = await response.blob()
  if (blob.type === 'image/svg+xml') return rasteriseSvg(blob)
  if (blob.type === 'image/png' || blob.type === 'image/jpeg') return readAsDataUrl(blob)
  throw new Error(`unsupported logo type ${blob.type}`)
}
