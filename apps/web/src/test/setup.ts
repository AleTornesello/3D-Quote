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

beforeEach(() => {
  window.localStorage.clear()
  initI18n('it')
})

afterEach(() => cleanup())
