import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { loadLogoDataUrl } from './logo'

function respond(blob: Blob, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, status, blob: async () => blob }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test.each(['image/png', 'image/jpeg'])('passes a %s through as a data URL', async (type) => {
  respond(new Blob(['x'], { type }))
  expect(await loadLogoDataUrl('https://x/logo')).toMatch(new RegExp(`^data:${type};base64,`))
})

test('rejects an unsupported type', async () => {
  respond(new Blob(['x'], { type: 'image/gif' }))
  await expect(loadLogoDataUrl('https://x/logo')).rejects.toThrow('unsupported logo type')
})

test('rejects a failed response', async () => {
  respond(new Blob([]), false, 404)
  await expect(loadLogoDataUrl('https://x/logo')).rejects.toThrow('logo 404')
})

describe('an SVG logo', () => {
  const canvas = { width: 0, height: 0, getContext: vi.fn(), toDataURL: vi.fn() }
  const drawImage = vi.fn()
  let size = { w: 100, h: 50 }
  let revoke: Mock<(url: string) => void>

  beforeEach(() => {
    size = { w: 100, h: 50 }
    canvas.width = 0
    canvas.height = 0
    drawImage.mockReset()
    canvas.getContext.mockReturnValue({ drawImage })
    canvas.toDataURL.mockReturnValue('data:image/png;base64,AAAA')
    revoke = vi.fn<(url: string) => void>()
    URL.createObjectURL = vi.fn(() => 'blob:svg')
    URL.revokeObjectURL = revoke
    vi.stubGlobal(
      'Image',
      class {
        src = ''
        get naturalWidth() {
          return size.w
        }
        get naturalHeight() {
          return size.h
        }
        decode() {
          return Promise.resolve()
        }
      },
    )
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as never)
    respond(new Blob(['<svg/>'], { type: 'image/svg+xml' }))
  })

  test('is drawn on a canvas scaled so its longest side is 800 px, then the URL is revoked', async () => {
    expect(await loadLogoDataUrl('https://x/logo.svg')).toBe('data:image/png;base64,AAAA')
    expect([canvas.width, canvas.height]).toEqual([800, 400])
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 400)
    expect(revoke).toHaveBeenCalledWith('blob:svg')
  })

  test('a large one is scaled down to 800 px', async () => {
    size = { w: 4000, h: 1000 }
    await loadLogoDataUrl('https://x/logo.svg')
    expect([canvas.width, canvas.height]).toEqual([800, 200])
  })

  test('one with no natural size is rejected, and its URL still revoked', async () => {
    size = { w: 0, h: 0 }
    await expect(loadLogoDataUrl('https://x/logo.svg')).rejects.toThrow()
    expect(revoke).toHaveBeenCalledWith('blob:svg')
  })
})
