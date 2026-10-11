import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useTranslation } from 'react-i18next'
import { afterEach, expect, test, vi } from 'vitest'
import { STORAGE_KEY } from '@/i18n'
import { LanguageSwitcher } from './LanguageSwitcher'

function Probe() {
  const { t } = useTranslation()
  return <p>{t('nav.quotes')}</p>
}

afterEach(() => vi.restoreAllMocks())

test('switches the UI language and remembers it', async () => {
  render(
    <>
      <LanguageSwitcher />
      <Probe />
    </>,
  )
  expect(screen.getByText('Preventivi')).toBeInTheDocument()

  await userEvent.selectOptions(screen.getByLabelText('Lingua'), 'en')

  expect(await screen.findByText('Quotes')).toBeInTheDocument()
  expect(document.documentElement.lang).toBe('en')
  expect(window.localStorage.getItem(STORAGE_KEY)).toBe('en')
})

test('switching works when localStorage throws', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  render(
    <>
      <LanguageSwitcher />
      <Probe />
    </>,
  )
  await userEvent.selectOptions(screen.getByLabelText('Lingua'), 'en')
  expect(await screen.findByText('Quotes')).toBeInTheDocument()
})
