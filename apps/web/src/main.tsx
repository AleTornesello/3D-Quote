import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App'
import { initI18n } from './i18n'
import { readEnv } from './lib/env'

initI18n()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App env={readEnv(import.meta.env)} />
  </StrictMode>,
)
