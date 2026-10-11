import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { readEnv } from '@/lib/env'
import App from './App'

test('shows the missing-config screen naming the missing variables', () => {
  render(<App env={readEnv({ VITE_SUPABASE_URL: 'https://x.supabase.co' })} />)
  expect(screen.getByRole('heading', { name: 'Supabase non configurato' })).toBeInTheDocument()
  expect(screen.getByText('VITE_SUPABASE_PUBLISHABLE_KEY')).toBeInTheDocument()
  expect(screen.queryByText('VITE_SUPABASE_URL')).not.toBeInTheDocument()
})
