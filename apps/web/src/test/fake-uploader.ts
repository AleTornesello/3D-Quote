import { act } from '@testing-library/react'
import type { ModelUploader } from '@/data/model-upload'

export type FakeUpload = {
  file: File
  path: string
  aborted: boolean
  progress: (fraction: number) => Promise<void>
  succeed: () => Promise<void>
  fail: (error: unknown) => Promise<void>
}

/** Uploads that tests advance, finish or fail by hand. */
export class FakeUploader {
  readonly uploads: FakeUpload[] = []

  readonly upload: ModelUploader = (file, path, { onProgress, signal }) =>
    new Promise<void>((resolve, reject) => {
      const entry: FakeUpload = {
        file,
        path,
        aborted: false,
        progress: (fraction) => act(async () => onProgress(fraction)),
        succeed: () => act(async () => resolve()),
        fail: (error) => act(async () => reject(error)),
      }
      signal.addEventListener('abort', () => {
        entry.aborted = true
        reject(new DOMException('Upload cancelled', 'AbortError'))
      })
      this.uploads.push(entry)
    })
}
