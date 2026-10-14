/** Saves `blob` as `fileName` through a temporary link. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  // The browser has started the download by now; release the memory a moment later.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
