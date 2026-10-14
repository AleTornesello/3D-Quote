import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { initI18n } from '@/i18n'

// A test file marked `// @vitest-environment node` has no DOM to prepare.
const hasDom = typeof window !== 'undefined'

if (hasDom) {
  // Parallel workers on a loaded machine make the 1 s default too tight for multi-step page tests.
  configure({ asyncUtilTimeout: 3000 })

  // jsdom has no ResizeObserver; Radix (e.g. Switch inside a form) measures with it.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  // jsdom has no matchMedia; sonner's Toaster reads the colour scheme with it.
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }) as MediaQueryList

  // jsdom has no scrollIntoView; cmdk scrolls the highlighted option into view.
  Element.prototype.scrollIntoView ??= function () {}

  // jsdom has no pointer capture; sonner calls it when a toast is pressed.
  Element.prototype.setPointerCapture ??= function () {}
}

beforeEach(() => {
  if (!hasDom) return
  window.localStorage.clear()
  initI18n('it')
})

afterEach(() => {
  if (hasDom) cleanup()
})
