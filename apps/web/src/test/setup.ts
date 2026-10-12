import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { initI18n } from '@/i18n'

// jsdom has no ResizeObserver; Radix (e.g. Switch inside a form) measures with it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  window.localStorage.clear()
  initI18n('it')
})

afterEach(() => cleanup())
