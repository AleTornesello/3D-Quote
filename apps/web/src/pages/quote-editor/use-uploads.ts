import { useEffect, useRef, useState } from 'react'
import { toAppError } from '@/data/errors'
import { useMaterials } from '@/data/materials'
import { useModelUploader } from '@/data/model-upload'
import { usePrinters } from '@/data/printers'
import { useCreateQuoteItem, type QuoteItem } from '@/data/quote-items'
import {
  defaultCatalogChoice,
  MAX_PARALLEL_UPLOADS,
  modelPath,
  safeObjectName,
  validateModelFile,
  type FileProblem,
} from '@/data/quote-rules'

export type UploadRow = {
  key: string
  name: string
  status: 'waiting' | 'uploading' | 'creating' | 'failed'
  progress: number
  /** i18n key of the failure. */
  error: string | null
}

export type RejectedFile = { key: string; name: string; problem: FileProblem }

export type Uploads = ReturnType<typeof useUploads>

/**
 * The editor's upload queue: at most MAX_PARALLEL_UPLOADS at once; each finished upload becomes an item. The files
 * stay in memory so a failed upload can be retried without choosing it again. Nothing survives a reload, and
 * nothing outlives the quote's draft status (`editable`).
 */
export function useUploads(
  quoteId: number,
  items: QuoteItem[],
  editable: boolean,
  onNotDraft: () => void,
) {
  const uploader = useModelUploader()
  const create = useCreateQuoteItem()
  const printers = usePrinters()
  const materials = useMaterials()
  const [rows, setRows] = useState<UploadRow[]>([])
  const [rejected, setRejected] = useState<RejectedFile[]>([])
  const files = useRef(new Map<string, File>())
  const waiting = useRef<string[]>([])
  const running = useRef(0)
  const controllers = useRef(new Map<string, AbortController>())
  // Uploads finish later; they must see the items and catalog of that moment, not of when they started.
  const latest = useRef({ items, printers: printers.data, materials: materials.data, onNotDraft })
  useEffect(() => {
    latest.current = { items, printers: printers.data, materials: materials.data, onNotDraft }
  })

  // Leaving the page cancels what is still uploading.
  useEffect(() => {
    const active = controllers.current
    const queued = waiting.current
    return () => {
      // Clear the queue first: each aborted run would otherwise pump the next waiting file.
      queued.length = 0
      active.forEach((controller) => controller.abort())
    }
  }, [])

  // The quote left draft: storage would refuse every remaining upload, and the zone showing them is gone.
  const [wasEditable, setWasEditable] = useState(editable)
  if (editable !== wasEditable) {
    setWasEditable(editable)
    if (!editable) setRows([])
  }
  useEffect(() => {
    if (editable) return
    // The rows are gone already (above); clear the queue before aborting, as on leaving.
    waiting.current.length = 0
    files.current.clear()
    controllers.current.forEach((controller) => controller.abort())
  }, [editable])

  // Closing or reloading the tab would lose them too; the browser asks with its own text.
  const busy = rows.some((row) => row.status !== 'failed')
  useEffect(() => {
    if (!busy) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Older Chrome and Edge also need returnValue set.
      event.returnValue = true
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  function patch(key: string, change: Partial<UploadRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)))
  }

  function drop(key: string) {
    files.current.delete(key)
    setRows((current) => current.filter((row) => row.key !== key))
  }

  /** Clears the queue and aborts what is running; each aborted run removes its own row. */
  function stopAll() {
    for (const key of waiting.current.splice(0)) drop(key)
    controllers.current.forEach((controller) => controller.abort())
  }

  function catalogDefaults() {
    const { items: now, printers: printerList, materials: materialList } = latest.current
    return defaultCatalogChoice(
      now,
      new Set((printerList ?? []).filter((p) => p.active).map((p) => p.id)),
      new Set((materialList ?? []).filter((m) => m.active).map((m) => m.id)),
    )
  }

  async function run(key: string) {
    const file = files.current.get(key)
    if (!file) return
    const controller = new AbortController()
    controllers.current.set(key, controller)
    patch(key, { status: 'uploading', progress: 0, error: null })
    const path = modelPath(quoteId, crypto.randomUUID(), safeObjectName(file.name))
    try {
      await uploader(file, path, {
        signal: controller.signal,
        onProgress: (progress) => patch(key, { progress }),
      })
      patch(key, { status: 'creating', progress: 1 })
      await create.mutateAsync({ quoteId, path, filename: file.name, ...catalogDefaults() })
      drop(key)
    } catch (caught) {
      if (controller.signal.aborted) {
        drop(key)
        return
      }
      const error = toAppError(caught)
      patch(key, { status: 'failed', error: error.messageKey })
      if (error.kind === 'notDraft') {
        // Every other upload would be refused the same way. This one is over: don't abort it too.
        controllers.current.delete(key)
        stopAll()
        latest.current.onNotDraft()
      }
    } finally {
      controllers.current.delete(key)
    }
  }

  function pump() {
    while (running.current < MAX_PARALLEL_UPLOADS && waiting.current.length > 0) {
      const key = waiting.current.shift() as string
      running.current += 1
      void run(key).finally(() => {
        running.current -= 1
        pump()
      })
    }
  }

  function add(list: File[]) {
    const accepted: UploadRow[] = []
    const refused: RejectedFile[] = []
    for (const file of list) {
      const key = crypto.randomUUID()
      const problem = validateModelFile(file)
      if (problem) {
        refused.push({ key, name: file.name, problem })
        continue
      }
      files.current.set(key, file)
      accepted.push({ key, name: file.name, status: 'waiting', progress: 0, error: null })
      waiting.current.push(key)
    }
    if (refused.length) setRejected((current) => [...current, ...refused])
    if (accepted.length) setRows((current) => [...current, ...accepted])
    pump()
  }

  function retry(key: string) {
    patch(key, { status: 'waiting', progress: 0, error: null })
    waiting.current.push(key)
    pump()
  }

  function cancel(key: string) {
    if (waiting.current.includes(key)) {
      waiting.current.splice(waiting.current.indexOf(key), 1)
      drop(key)
      return
    }
    controllers.current.get(key)?.abort()
  }

  return {
    rows,
    rejected,
    /** Uploads that leaving the page would cancel. */
    busy,
    add,
    retry,
    cancel,
    dismiss: drop,
    dismissRejected: (key: string) =>
      setRejected((current) => current.filter((file) => file.key !== key)),
  }
}
