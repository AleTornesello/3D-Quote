import { createContext, useContext } from 'react'
import { Upload, type DetailedError } from 'tus-js-client'
import type { SupabaseEnv } from '@/lib/env'
import type { AppSupabaseClient } from '@/lib/supabase'
import { AppError, fromUploadResponse } from './errors'

export type UploadOptions = { onProgress: (fraction: number) => void; signal: AbortSignal }

/** Uploads `file` to `models/<path>`. Rejects with an AppError, or with an AbortError once `signal` aborts. */
export type ModelUploader = (file: File, path: string, options: UploadOptions) => Promise<void>

export const ModelUploaderContext = createContext<ModelUploader | null>(null)

export function useModelUploader(): ModelUploader {
  const uploader = useContext(ModelUploaderContext)
  if (!uploader) throw new Error('useModelUploader must be used inside <ModelUploaderContext>')
  return uploader
}

// Supabase's resumable endpoint requires 6 MB chunks.
const CHUNK_SIZE = 6 * 1024 * 1024

function toUploadError(error: Error | DetailedError): AppError {
  const response = 'originalResponse' in error ? error.originalResponse : null
  return fromUploadResponse(
    response ? response.getStatus() : null,
    response?.getBody() ?? '',
    error,
  )
}

/**
 * Resumable (TUS) uploads to Supabase Storage: progress events, and retries that resume after a dropped
 * connection. The models storage policies apply because the request carries the user's token.
 */
export function createTusUploader(supabase: AppSupabaseClient, env: SupabaseEnv): ModelUploader {
  const endpoint = `${env.url.replace(/\/+$/, '')}/storage/v1/upload/resumable`
  return async (file, path, { onProgress, signal }) => {
    // Read per upload: a long session refreshes its token.
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new AppError('sessionExpired')
    await new Promise<void>((resolve, reject) => {
      const upload = new Upload(file, {
        endpoint,
        retryDelays: [0, 3000, 5000, 10000],
        headers: { authorization: `Bearer ${token}`, apikey: env.publishableKey },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: CHUNK_SIZE,
        metadata: {
          bucketName: 'models',
          objectName: path,
          contentType: file.type || 'application/octet-stream',
          cacheControl: '3600',
        },
        onProgress: (sent, total) => onProgress(total > 0 ? sent / total : 0),
        onSuccess: () => resolve(),
        onError: (error) => reject(toUploadError(error)),
      })
      signal.addEventListener(
        'abort',
        () => {
          void upload.abort(true)
          reject(new DOMException('Upload cancelled', 'AbortError'))
        },
        { once: true },
      )
      upload.start()
    })
  }
}
