import { beforeEach, expect, test, vi } from 'vitest'
import type { AppSupabaseClient } from '@/lib/supabase'
import { createTusUploader } from './model-upload'

const tus = vi.hoisted(() => ({
  instances: [] as { options: Record<string, unknown>; start: () => void; abort: () => void }[],
}))

vi.mock('tus-js-client', () => ({
  Upload: vi.fn(function Upload(this: unknown, _file: File, options: Record<string, unknown>) {
    const instance = {
      options,
      start: vi.fn(() => (options.onSuccess as () => void)()),
      abort: vi.fn(async () => {}),
    }
    tus.instances.push(instance)
    return instance
  }),
}))

beforeEach(() => {
  tus.instances.length = 0
})

const env = { url: 'https://abc.supabase.co/', publishableKey: 'sb_publishable_key' }

function client(getSession: () => Promise<unknown>) {
  return { auth: { getSession } } as unknown as AppSupabaseClient
}

const session = { data: { session: { access_token: 'token-1' } } }
const file = new File(['solid part'], 'Staffa.stl', { type: 'model/stl' })

test('a cancel while the session is being read stops before uploading anything', async () => {
  let resolveSession: (value: unknown) => void = () => {}
  const upload = createTusUploader(
    client(() => new Promise((resolve) => (resolveSession = resolve))),
    env,
  )
  const controller = new AbortController()
  const result = upload(file, '7/u1/Staffa.stl', {
    onProgress: () => {},
    signal: controller.signal,
  })
  controller.abort()
  resolveSession(session)
  await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  expect(tus.instances).toHaveLength(0)
})

test("uploads in 6 MB chunks to the resumable endpoint with the user's token", async () => {
  const upload = createTusUploader(
    client(async () => session),
    env,
  )
  await upload(file, '7/u1/Staffa.stl', {
    onProgress: () => {},
    signal: new AbortController().signal,
  })
  expect(tus.instances).toHaveLength(1)
  const { options, start } = tus.instances[0]
  expect(start).toHaveBeenCalled()
  expect(options).toMatchObject({
    endpoint: 'https://abc.supabase.co/storage/v1/upload/resumable',
    headers: { authorization: 'Bearer token-1', apikey: 'sb_publishable_key' },
    chunkSize: 6 * 1024 * 1024,
    metadata: { bucketName: 'models', objectName: '7/u1/Staffa.stl', contentType: 'model/stl' },
  })
})
