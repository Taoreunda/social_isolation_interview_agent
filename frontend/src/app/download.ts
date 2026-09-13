/** Handing a generated file to the browser, in the one place that knows how. */

export function canSaveBlob(): boolean {
  return typeof document !== 'undefined'
    && Boolean(document.body)
    && typeof URL !== 'undefined'
    && typeof URL.createObjectURL === 'function'
    && typeof URL.revokeObjectURL === 'function'
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
