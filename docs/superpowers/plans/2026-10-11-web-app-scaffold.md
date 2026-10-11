# Web App Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `apps/web` — a Vite + React + TypeScript app with Tailwind/shadcn, React Router, TanStack Query, Supabase auth, i18n (it/en), an app shell with placeholder pages, and passing build/lint/format/test.

**Architecture:** One npm workspace package `@3d-quote/web`. The Supabase client is created once from env and provided through React context, so tests inject a fake client instead of mocking modules. Routes are a plain `RouteObject[]` used by `createBrowserRouter` in the app and `createMemoryRouter` in tests. i18n is a module-level i18next instance initialised before render.

**Tech Stack:** Vite 8, React 19, TypeScript ~6.0 (template pin), Tailwind 4 + `@tailwindcss/vite`, shadcn (radix base, nova preset), React Router 8, TanStack Query 5, supabase-js 2, i18next 26 + react-i18next 17, Vitest 5 + jsdom + Testing Library, ESLint 9 + typescript-eslint + react-hooks + react-refresh + jsx-a11y, Prettier 3 + prettier-plugin-tailwindcss.

**Spec:** `docs/superpowers/specs/2026-10-11-web-app-scaffold-design.md`

## Global Constraints

- All commits on branch `develop`; never push unless asked.
- Package name `@3d-quote/web`, private. All npm commands run from the repo root (`C:\Progetti` above it has an unrelated npm project).
- Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Languages `it` (default/fallback) and `en`; localStorage key `3dq.language`.
- Every user-visible string comes from `src/i18n/locales/{it,en}.json`; both have the same keys.
- Code style: no semicolons, single quotes, trailing commas, print width 100 (Prettier enforces).
- Done = `npm run build`, `npm run lint`, `npm run format:check`, `npm test` all pass from the repo root.

## Findings from probing (2026-10-11) that differ from the spec

- `create-vite` 9 `react-ts` ships **oxlint**, not ESLint, and pins **TypeScript ~6.0.2**. We remove oxlint and add ESLint (the spec's choice) and keep TS 6.0 (inside `typescript-eslint`'s supported range `<6.1`).
- `eslint-plugin-jsx-a11y` 6.10 does not support ESLint 10 → use **ESLint 9** and `@eslint/js` 9.
- `shadcn init` needs `-t vite -b radix -p nova` to run without prompts. It installs `cn` (shadcn's own replacement for clsx + tailwind-merge), `radix-ui`, `lucide-react`, `class-variance-authority`, `tw-animate-css`, `@fontsource-variable/geist`, `shadcn`.

## Review Focus

1. **Login while already signed in / after sign-in race** — the auth listener and the explicit navigate both fire; user must land once on the remembered path, never bounce back to `/login`. Pinned by Task 4 test "lands on the remembered path".
2. **Storage unavailable** (private mode, blocked storage) — language switching must still work, only persistence is lost. Pinned by Task 2 test "switching works when localStorage throws".
3. **Browser languages like `en-US` / `it-CH` / `de-DE`** — map to `en` / `it` / fallback `it`. Pinned by Task 2 `detectLanguage` tests.
4. **Empty-string env vars** (`VITE_SUPABASE_URL=` copied from `.env.example`) — must count as missing. Pinned by Task 3 test.
5. **Session still loading on a protected route** — must not flash or redirect to `/login`. Pinned by Task 4 test "shows loading, not login, while the session loads".

---

### Task 1: Generate the app and toolchain

**Files:**
- Delete: `apps/web/.gitkeep`
- Create (generator): `apps/web/{index.html,package.json,vite.config.ts,tsconfig.json,tsconfig.app.json,tsconfig.node.json,.gitignore,src/main.tsx,src/index.css,public/favicon.svg}`
- Delete (template leftovers): `apps/web/.oxlintrc.json`, `apps/web/README.md`, `apps/web/src/App.css`, `apps/web/src/App.tsx`, `apps/web/src/assets/`, `apps/web/public/icons.svg`
- Create: `apps/web/eslint.config.js`, `apps/web/.prettierrc.json`, `apps/web/.prettierignore`, `apps/web/.env.example`, `apps/web/README.md`, `apps/web/src/test/setup.ts`, `apps/web/src/app/App.tsx` (temporary), `apps/web/src/app/App.test.tsx` (temporary smoke test)
- Create (shadcn): `apps/web/components.json`, `apps/web/src/lib/utils.ts`, `apps/web/src/components/ui/button.tsx`; modifies `src/index.css`
- Modify: root `package.json` (scripts), `package-lock.json`

**Interfaces:**
- Produces: `@/` alias → `apps/web/src`; `cn()` from `@/lib/utils`; `Button` from `@/components/ui/button`; test setup at `src/test/setup.ts`; scripts `dev|build|preview|test|test:watch|lint|format|format:check`.

- [ ] **Step 1: Generate the template**

```bash
git rm -q apps/web/.gitkeep
npm create vite@latest apps/web -- --template react-ts --no-interactive
```
Expected: `apps/web/package.json` exists with `"name": "web"`.

- [ ] **Step 2: Rename the package, remove oxlint and template leftovers**

```bash
node -e "const f='apps/web/package.json',fs=require('fs'),p=JSON.parse(fs.readFileSync(f));p.name='@3d-quote/web';fs.writeFileSync(f,JSON.stringify(p,null,2)+'\n')"
rm -rf apps/web/.oxlintrc.json apps/web/README.md apps/web/src/App.css apps/web/src/App.tsx apps/web/src/assets apps/web/public/icons.svg
npm install
npm uninstall oxlint --workspace @3d-quote/web
```

- [ ] **Step 3: Install runtime and dev dependencies**

```bash
npm install --workspace @3d-quote/web react-router @tanstack/react-query @supabase/supabase-js i18next react-i18next tailwindcss @tailwindcss/vite
npm install --workspace @3d-quote/web -D eslint@^9 @eslint/js@^9 typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh eslint-plugin-jsx-a11y globals prettier prettier-plugin-tailwindcss vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```
Expected: no `ERESOLVE`; `node_modules` only at the repo root (`apps/web/node_modules` may hold a few non-hoisted packages — fine).

- [ ] **Step 4: Write config files**

`apps/web/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
```

In `apps/web/tsconfig.json` and `apps/web/tsconfig.app.json` add to `compilerOptions` (create the key in `tsconfig.json`):
```json
"paths": { "@/*": ["./src/*"] }
```
and in `tsconfig.app.json` also add `"resolveJsonModule": true`.

`apps/web/eslint.config.js`:
```js
import js from '@eslint/js'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
  },
  {
    // shadcn components and test helpers export non-components by design.
    files: ['src/components/ui/**/*.tsx', 'src/test/**/*.tsx', '**/*.test.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
```

`apps/web/.prettierrc.json`:
```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "plugins": ["prettier-plugin-tailwindcss"],
  "tailwindStylesheet": "./src/index.css"
}
```

`apps/web/.prettierignore`:
```
dist
coverage
```

`apps/web/.env.example`:
```bash
# Copy to .env.local and fill in from your Supabase project (Project Settings → API).
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

`apps/web/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => cleanup())
```

Replace `apps/web/src/index.css` with:
```css
@import 'tailwindcss';
```

In `apps/web/index.html` set `<html lang="it">` and `<title>3D-Quote</title>`.

`apps/web/README.md`:
```markdown
# @3d-quote/web

Staff web app for 3D-Quote. See [docs/frontend/web-app.md](../../docs/frontend/web-app.md).
```

- [ ] **Step 5: Package scripts**

In `apps/web/package.json` set `scripts` to:
```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "lint": "eslint .",
  "format": "prettier --write .",
  "format:check": "prettier --check ."
}
```
In the root `package.json` add:
```json
"scripts": {
  "dev": "npm run dev --workspace @3d-quote/web",
  "build": "npm run build --workspace @3d-quote/web",
  "test": "npm run test --workspace @3d-quote/web",
  "lint": "npm run lint --workspace @3d-quote/web",
  "format": "npm run format --workspace @3d-quote/web",
  "format:check": "npm run format:check --workspace @3d-quote/web"
}
```

- [ ] **Step 6: Write the failing smoke test**

`apps/web/src/app/App.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from './App'

test('renders the app name', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: '3D-Quote' })).toBeInTheDocument()
})
```

Run: `npm test`
Expected: FAIL — cannot resolve `./App`.

- [ ] **Step 7: Initialise shadcn and add the temporary App**

```bash
npx --yes shadcn@latest init -c apps/web -t vite -b radix -p nova --no-monorepo --no-rtl --no-pointer -y
```
Expected: creates `apps/web/components.json`, `src/lib/utils.ts`, `src/components/ui/button.tsx`; rewrites `src/index.css` with theme tokens. If it asks a question, the run is wrong — stop and re-check flags.

`apps/web/src/app/App.tsx` (temporary — replaced in Task 3):
```tsx
import { Button } from '@/components/ui/button'

export default function App() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">3D-Quote</h1>
      <Button>OK</Button>
    </main>
  )
}
```

Update `apps/web/src/main.tsx` to import `./app/App` instead of `./App.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 8: Format, then verify everything**

```bash
npm run format
npm test && npm run lint && npm run format:check && npm run build
```
Expected: 1 test passes; lint clean; format check clean; build writes `apps/web/dist/`.

- [ ] **Step 9: Commit**

```bash
git add -A apps/web package.json package-lock.json
git status --short   # no dist/, node_modules/, .env.local
git commit -m "feat(web): scaffold Vite React app with Tailwind, shadcn, ESLint, Prettier and Vitest"
```

---

### Task 2: i18n and language switcher

**Files:**
- Create: `apps/web/src/i18n/index.ts`, `apps/web/src/i18n/locales/it.json`, `apps/web/src/i18n/locales/en.json`, `apps/web/src/i18n/i18n.test.ts`
- Create: `apps/web/src/layout/LanguageSwitcher.tsx`, `apps/web/src/layout/LanguageSwitcher.test.tsx`
- Modify: `apps/web/src/test/setup.ts`, `apps/web/src/main.tsx`

**Interfaces:**
- Produces: `LANGUAGES`, `type Language`, `STORAGE_KEY = '3dq.language'`, `detectLanguage(stored: string | null, browser: readonly string[]): Language`, `initI18n(lng?: Language): i18n`, `setLanguage(lng: Language): Promise<void>` from `@/i18n`; `<LanguageSwitcher />` from `@/layout/LanguageSwitcher`.

- [ ] **Step 1: Write the catalogs**

`apps/web/src/i18n/locales/it.json`:
```json
{
  "app": { "name": "3D-Quote" },
  "nav": {
    "main": "Navigazione principale",
    "menu": "Menu",
    "quotes": "Preventivi",
    "clients": "Clienti",
    "printers": "Stampanti",
    "materials": "Materiali",
    "settings": "Impostazioni",
    "staff": "Personale",
    "account": "Account",
    "logout": "Esci"
  },
  "language": { "label": "Lingua", "it": "Italiano", "en": "English" },
  "pages": {
    "comingSoon": "In arrivo.",
    "notFound": {
      "title": "Pagina non trovata",
      "body": "La pagina che cerchi non esiste.",
      "back": "Torna ai preventivi"
    }
  },
  "auth": {
    "loading": "Caricamento…",
    "login": {
      "title": "Accedi",
      "email": "Email",
      "password": "Password",
      "submit": "Accedi",
      "submitting": "Accesso in corso…",
      "forgot": "Password dimenticata?",
      "error": "Email o password non corretti."
    },
    "forgot": {
      "title": "Recupera password",
      "body": "Inserisci la tua email: ti invieremo un link per reimpostare la password.",
      "email": "Email",
      "submit": "Invia link",
      "sent": "Se l'indirizzo è registrato, riceverai a breve un'email con le istruzioni.",
      "back": "Torna all'accesso"
    }
  },
  "config": {
    "title": "Supabase non configurato",
    "body": "Imposta le variabili mancanti in apps/web/.env.local (vedi apps/web/.env.example) e riavvia il server di sviluppo.",
    "missing": "Variabili mancanti:"
  }
}
```

`apps/web/src/i18n/locales/en.json`:
```json
{
  "app": { "name": "3D-Quote" },
  "nav": {
    "main": "Main navigation",
    "menu": "Menu",
    "quotes": "Quotes",
    "clients": "Clients",
    "printers": "Printers",
    "materials": "Materials",
    "settings": "Settings",
    "staff": "Staff",
    "account": "Account",
    "logout": "Log out"
  },
  "language": { "label": "Language", "it": "Italiano", "en": "English" },
  "pages": {
    "comingSoon": "Coming soon.",
    "notFound": {
      "title": "Page not found",
      "body": "The page you're looking for doesn't exist.",
      "back": "Back to quotes"
    }
  },
  "auth": {
    "loading": "Loading…",
    "login": {
      "title": "Log in",
      "email": "Email",
      "password": "Password",
      "submit": "Log in",
      "submitting": "Logging in…",
      "forgot": "Forgot your password?",
      "error": "Incorrect email or password."
    },
    "forgot": {
      "title": "Reset password",
      "body": "Enter your email and we'll send you a link to reset your password.",
      "email": "Email",
      "submit": "Send link",
      "sent": "If that address is registered, you'll receive an email with instructions shortly.",
      "back": "Back to log in"
    }
  },
  "config": {
    "title": "Supabase is not configured",
    "body": "Set the missing variables in apps/web/.env.local (see apps/web/.env.example) and restart the dev server.",
    "missing": "Missing variables:"
  }
}
```

- [ ] **Step 2: Write the failing i18n tests**

`apps/web/src/i18n/i18n.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { detectLanguage } from '@/i18n'
import en from '@/i18n/locales/en.json'
import it from '@/i18n/locales/it.json'

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  )
}

test('it and en catalogs have the same keys', () => {
  expect(keys(en).sort()).toEqual(keys(it).sort())
})

describe('detectLanguage', () => {
  test('prefers a valid stored language', () => {
    expect(detectLanguage('en', ['it-IT'])).toBe('en')
  })
  test('ignores an invalid stored value', () => {
    expect(detectLanguage('fr', ['en-US'])).toBe('en')
  })
  test('maps regional browser tags to the base language', () => {
    expect(detectLanguage(null, ['it-CH'])).toBe('it')
    expect(detectLanguage(null, ['de-DE', 'en-GB'])).toBe('en')
  })
  test('falls back to Italian', () => {
    expect(detectLanguage(null, ['de-DE'])).toBe('it')
    expect(detectLanguage(null, [])).toBe('it')
  })
})
```

`apps/web/src/layout/LanguageSwitcher.test.tsx`:
```tsx
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
```

Run: `npm test`
Expected: FAIL — `@/i18n` and `./LanguageSwitcher` don't exist.

- [ ] **Step 3: Implement i18n**

`apps/web/src/i18n/index.ts`:
```ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import it from './locales/it.json'

export const LANGUAGES = ['it', 'en'] as const
export type Language = (typeof LANGUAGES)[number]
export const STORAGE_KEY = '3dq.language'

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

/** Stored choice first, then the first supported browser language, then Italian. */
export function detectLanguage(stored: string | null, browser: readonly string[]): Language {
  if (isLanguage(stored)) return stored
  for (const tag of browser) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLanguage(base)) return base
  }
  return 'it'
}

function readStoredLanguage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function initI18n(
  lng: Language = detectLanguage(readStoredLanguage(), navigator.languages ?? []),
) {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      resources: { it: { translation: it }, en: { translation: en } },
      lng,
      fallbackLng: 'it',
      interpolation: { escapeValue: false },
      initAsync: false,
    })
  } else {
    void i18n.changeLanguage(lng)
  }
  document.documentElement.lang = lng
  return i18n
}

/** Changes the UI language and remembers it; persistence failures are ignored. */
export async function setLanguage(lng: Language) {
  await i18n.changeLanguage(lng)
  document.documentElement.lang = lng
  try {
    window.localStorage.setItem(STORAGE_KEY, lng)
  } catch {
    // Storage unavailable (private mode, blocked): the choice lasts for this session only.
  }
}
```

`apps/web/src/layout/LanguageSwitcher.tsx`:
```tsx
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, setLanguage, type Language } from '@/i18n'

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const id = useId()
  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor={id} className="text-muted-foreground">
        {t('language.label')}
      </label>
      <select
        id={id}
        value={i18n.language}
        onChange={(event) => void setLanguage(event.target.value as Language)}
        className="border-input bg-background h-8 rounded-md border px-2"
      >
        {LANGUAGES.map((lng) => (
          <option key={lng} value={lng}>
            {t(`language.${lng}`)}
          </option>
        ))}
      </select>
    </div>
  )
}
```

Update `apps/web/src/test/setup.ts` so every test starts in Italian with empty storage:
```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { initI18n } from '@/i18n'

beforeEach(() => {
  window.localStorage.clear()
  initI18n('it')
})

afterEach(() => cleanup())
```

`apps/web/src/main.tsx` (initialise i18n before rendering):
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App'
import { initI18n } from './i18n'

initI18n()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all i18n, switcher and smoke tests PASS. If `initAsync` is rejected by the installed i18next, check its changelog for the synchronous-init option name and use it (ledger the ruling).

- [ ] **Step 5: Lint, format, commit**

```bash
npm run format && npm run lint && npm run format:check
git add apps/web
git commit -m "feat(web): add Italian/English i18n and language switcher"
```

---

### Task 3: Environment, Supabase client and missing-config screen

**Files:**
- Create: `apps/web/src/lib/env.ts`, `apps/web/src/lib/env.test.ts`, `apps/web/src/lib/supabase.ts`, `apps/web/src/lib/query-client.ts`, `apps/web/src/pages/ConfigErrorPage.tsx`
- Modify: `apps/web/src/app/App.tsx`, `apps/web/src/app/App.test.tsx`, `apps/web/src/main.tsx`

**Interfaces:**
- Consumes: `initI18n`, translations (Task 2).
- Produces:
  - `type SupabaseEnv = { url: string; publishableKey: string }`, `type EnvResult = { ok: true; env: SupabaseEnv } | { ok: false; missing: string[] }`, `readEnv(source: Record<string, unknown>): EnvResult` from `@/lib/env`
  - `createSupabaseClient(env: SupabaseEnv): SupabaseClient`, `SupabaseContext`, `useSupabase(): SupabaseClient` from `@/lib/supabase`
  - `createQueryClient(): QueryClient` from `@/lib/query-client`
  - `<ConfigErrorPage missing={string[]} />`
  - `App({ env }: { env: EnvResult })` default export from `@/app/App` (renders `ConfigErrorPage` when `!env.ok`; Task 5 fills the ok branch)

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/env.test.ts`:
```ts
import { expect, test } from 'vitest'
import { readEnv } from './env'

test('reads both variables', () => {
  expect(
    readEnv({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'pk' }),
  ).toEqual({ ok: true, env: { url: 'https://x.supabase.co', publishableKey: 'pk' } })
})

test('reports missing and empty variables', () => {
  expect(readEnv({ VITE_SUPABASE_URL: '  ' })).toEqual({
    ok: false,
    missing: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'],
  })
})
```

Replace `apps/web/src/app/App.test.tsx`:
```tsx
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
```

Run: `npm test`
Expected: FAIL — `./env` missing; `App` has no `env` prop / heading not found.

- [ ] **Step 2: Implement env, Supabase context, query client**

`apps/web/src/lib/env.ts`:
```ts
export type SupabaseEnv = { url: string; publishableKey: string }
export type EnvResult = { ok: true; env: SupabaseEnv } | { ok: false; missing: string[] }

function value(source: Record<string, unknown>, name: string): string | null {
  const raw = source[name]
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null
}

/** Reads the Supabase settings from Vite env; empty strings count as missing. */
export function readEnv(source: Record<string, unknown>): EnvResult {
  const url = value(source, 'VITE_SUPABASE_URL')
  const publishableKey = value(source, 'VITE_SUPABASE_PUBLISHABLE_KEY')
  if (url && publishableKey) return { ok: true, env: { url, publishableKey } }
  const missing: string[] = []
  if (!url) missing.push('VITE_SUPABASE_URL')
  if (!publishableKey) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY')
  return { ok: false, missing }
}
```

`apps/web/src/lib/supabase.ts`:
```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'
import type { SupabaseEnv } from './env'

export function createSupabaseClient(env: SupabaseEnv): SupabaseClient {
  return createClient(env.url, env.publishableKey)
}

export const SupabaseContext = createContext<SupabaseClient | null>(null)

export function useSupabase(): SupabaseClient {
  const client = useContext(SupabaseContext)
  if (!client) throw new Error('useSupabase must be used inside <SupabaseContext>')
  return client
}
```

`apps/web/src/lib/query-client.ts`:
```ts
import { QueryClient } from '@tanstack/react-query'

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  })
}
```

`apps/web/src/pages/ConfigErrorPage.tsx`:
```tsx
import { useTranslation } from 'react-i18next'

export function ConfigErrorPage({ missing }: { missing: string[] }) {
  const { t } = useTranslation()
  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="mb-2 text-2xl font-semibold">{t('config.title')}</h1>
      <p className="text-muted-foreground mb-4">{t('config.body')}</p>
      <p className="font-medium">{t('config.missing')}</p>
      <ul className="list-disc pl-6 font-mono text-sm">
        {missing.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </main>
  )
}
```

`apps/web/src/app/App.tsx` (the ok branch is completed in Task 5):
```tsx
import type { EnvResult } from '@/lib/env'
import { ConfigErrorPage } from '@/pages/ConfigErrorPage'

export default function App({ env }: { env: EnvResult }) {
  if (!env.ok) return <ConfigErrorPage missing={env.missing} />
  return null
}
```

`apps/web/src/main.tsx`:
```tsx
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
```

- [ ] **Step 3: Run tests, lint, format, commit**

```bash
npm test && npm run format && npm run lint && npm run format:check
git add apps/web
git commit -m "feat(web): read Supabase env and show a missing-config screen"
```
Expected: all tests PASS.

---

### Task 4: Auth — session provider, guard, login and forgot password

**Files:**
- Create: `apps/web/src/auth/auth-context.ts`, `apps/web/src/auth/AuthProvider.tsx`, `apps/web/src/auth/RequireAuth.tsx`
- Create: `apps/web/src/pages/LoginPage.tsx`, `apps/web/src/pages/ForgotPasswordPage.tsx`, `apps/web/src/pages/SectionPage.tsx`
- Create: `apps/web/src/app/AppProviders.tsx`
- Create: `apps/web/src/test/fake-supabase.ts`, `apps/web/src/test/render-app.tsx`
- Create: `apps/web/src/auth/auth.test.tsx`, `apps/web/src/pages/ForgotPasswordPage.test.tsx`
- Create (shadcn): `src/components/ui/{input,label,card}.tsx`
- Create (temporary, replaced in Task 5): `apps/web/src/app/routes.tsx`

**Interfaces:**
- Consumes: `SupabaseContext`, `useSupabase`, `createQueryClient` (Task 3); `LanguageSwitcher` (Task 2).
- Produces:
  - `type AuthState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; session: Session }`, `AuthContext`, `useAuth(): AuthState` from `@/auth/auth-context`
  - `<AuthProvider>`, `<RequireAuth />` (layout route element)
  - `<AppProviders client={SupabaseClient} queryClient={QueryClient}>`
  - `<SectionPage titleKey={string} />` from `@/pages/SectionPage` (h1 + "coming soon")
  - `routes: RouteObject[]` from `@/app/routes`
  - test helpers `createFakeSupabase(opts)`, `fakeSession(email?)`, `renderApp(path, opts)`

- [ ] **Step 1: Add shadcn components**

```bash
npx --yes shadcn@latest add input label card -c apps/web -y
```

- [ ] **Step 2: Write test helpers**

`apps/web/src/test/fake-supabase.ts`:
```ts
import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js'
import { vi } from 'vitest'

type Listener = (event: AuthChangeEvent, session: Session | null) => void

export function fakeSession(email = 'staff@example.com'): Session {
  return {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: 'user-1',
      email,
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    },
  } as Session
}

/** A stand-in for supabase.auth with controllable outcomes. `pendingSession` keeps getSession unresolved. */
export function createFakeSupabase(
  opts: { session?: Session | null; signInError?: string; pendingSession?: boolean } = {},
) {
  let current = opts.session ?? null
  const listeners = new Set<Listener>()
  const emit = (event: AuthChangeEvent) => listeners.forEach((l) => l(event, current))

  const auth = {
    getSession: vi.fn(() =>
      opts.pendingSession
        ? new Promise<never>(() => {})
        : Promise.resolve({ data: { session: current }, error: null }),
    ),
    onAuthStateChange: vi.fn((listener: Listener) => {
      listeners.add(listener)
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }
    }),
    signInWithPassword: vi.fn(async ({ email }: { email: string; password: string }) => {
      if (opts.signInError) {
        return { data: { session: null, user: null }, error: { message: opts.signInError } }
      }
      current = fakeSession(email)
      emit('SIGNED_IN')
      return { data: { session: current, user: current.user }, error: null }
    }),
    resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
    signOut: vi.fn(async () => {
      current = null
      emit('SIGNED_OUT')
      return { error: null }
    }),
  }

  return { client: { auth } as unknown as SupabaseClient, auth }
}
```

`apps/web/src/test/render-app.tsx`:
```tsx
import type { Session } from '@supabase/supabase-js'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AppProviders } from '@/app/AppProviders'
import { routes } from '@/app/routes'
import { createQueryClient } from '@/lib/query-client'
import { createFakeSupabase } from './fake-supabase'

export function renderApp(
  path: string,
  opts: { session?: Session | null; signInError?: string; pendingSession?: boolean } = {},
) {
  const fake = createFakeSupabase(opts)
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <AppProviders client={fake.client} queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...fake, router }
}
```

- [ ] **Step 3: Write the failing auth tests**

`apps/web/src/auth/auth.test.tsx`:
```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { renderApp } from '@/test/render-app'

async function logIn(email = 'staff@example.com', password = 'secret') {
  await userEvent.type(await screen.findByLabelText('Email'), email)
  await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByRole('button', { name: 'Accedi' }))
}

test('redirects to login when signed out', async () => {
  const { router } = renderApp('/clients')
  expect(await screen.findByRole('heading', { name: 'Accedi' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/login')
})

test('shows loading, not login, while the session loads', async () => {
  const { router } = renderApp('/clients', { pendingSession: true })
  expect(await screen.findByRole('status')).toHaveTextContent('Caricamento…')
  expect(router.state.location.pathname).toBe('/clients')
})

test('logs in with email and password and lands on the remembered path', async () => {
  const { auth, router } = renderApp('/clients')
  await logIn('anna@example.com', 'pw-123')
  expect(auth.signInWithPassword).toHaveBeenCalledWith({
    email: 'anna@example.com',
    password: 'pw-123',
  })
  expect(await screen.findByRole('heading', { name: 'Clienti' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/clients')
})

test('shows an error and stays on login when sign-in fails', async () => {
  const { router } = renderApp('/login', { signInError: 'Invalid login credentials' })
  await logIn()
  expect(await screen.findByRole('alert')).toHaveTextContent('Email o password non corretti.')
  expect(router.state.location.pathname).toBe('/login')
})

test('a signed-in user visiting login goes to quotes', async () => {
  const { router } = renderApp('/login', { session: fakeSession() })
  expect(await screen.findByRole('heading', { name: 'Preventivi' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/quotes')
})
```

`apps/web/src/pages/ForgotPasswordPage.test.tsx`:
```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { renderApp } from '@/test/render-app'

test('requests a reset email and always shows the same confirmation', async () => {
  const { auth } = renderApp('/forgot-password')
  await userEvent.type(await screen.findByLabelText('Email'), 'anna@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Invia link' }))
  expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('anna@example.com', {
    redirectTo: `${window.location.origin}/account`,
  })
  expect(await screen.findByRole('status')).toHaveTextContent(
    "Se l'indirizzo è registrato, riceverai a breve un'email con le istruzioni.",
  )
})
```

Run: `npm test`
Expected: FAIL — `@/app/AppProviders`, `@/app/routes` not found.

- [ ] **Step 4: Implement auth**

`apps/web/src/auth/auth-context.ts`:
```ts
import type { Session } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; session: Session }

export const AuthContext = createContext<AuthState>({ status: 'loading' })

export function useAuth(): AuthState {
  return useContext(AuthContext)
}

export function toAuthState(session: Session | null): AuthState {
  return session ? { status: 'signedIn', session } : { status: 'signedOut' }
}
```

`apps/web/src/auth/AuthProvider.tsx`:
```tsx
import { useEffect, useState, type ReactNode } from 'react'
import { useSupabase } from '@/lib/supabase'
import { AuthContext, toAuthState, type AuthState } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useSupabase()
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setState(toAuthState(data.session))
    })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(toAuthState(session))
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [supabase])

  return <AuthContext value={state}>{children}</AuthContext>
}
```

`apps/web/src/auth/RequireAuth.tsx`:
```tsx
import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './auth-context'

/** Layout route: renders children only with a session; otherwise sends the user to /login. */
export function RequireAuth() {
  const auth = useAuth()
  const location = useLocation()
  const { t } = useTranslation()

  if (auth.status === 'loading') {
    return (
      <p role="status" className="text-muted-foreground p-6">
        {t('auth.loading')}
      </p>
    )
  }
  if (auth.status === 'signedOut') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  return <Outlet />
}
```

`apps/web/src/pages/LoginPage.tsx`:
```tsx
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { useAuth } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LanguageSwitcher } from '@/layout/LanguageSwitcher'
import { useSupabase } from '@/lib/supabase'

export function LoginPage() {
  const { t } = useTranslation()
  const supabase = useSupabase()
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [failed, setFailed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const from = (location.state as { from?: string } | null)?.from ?? '/quotes'

  if (auth.status === 'signedIn') return <Navigate to={from} replace />

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSubmitting(true)
    setFailed(false)
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get('email')),
      password: String(form.get('password')),
    })
    setSubmitting(false)
    if (error) setFailed(true)
    else navigate(from, { replace: true })
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold">{t('auth.login.title')}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">{t('auth.login.email')}</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">{t('auth.login.password')}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {failed && (
              <p role="alert" className="text-destructive text-sm">
                {t('auth.login.error')}
              </p>
            )}
            <Button type="submit" disabled={submitting}>
              {submitting ? t('auth.login.submitting') : t('auth.login.submit')}
            </Button>
            <Link to="/forgot-password" className="text-sm underline-offset-4 hover:underline">
              {t('auth.login.forgot')}
            </Link>
          </form>
          <div className="mt-6">
            <LanguageSwitcher />
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
```

`apps/web/src/pages/ForgotPasswordPage.tsx`:
```tsx
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSupabase } from '@/lib/supabase'

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const supabase = useSupabase()
  const [sent, setSent] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = String(new FormData(event.currentTarget).get('email'))
    // The result is deliberately ignored: the page never reveals whether an address exists.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/account`,
    })
    setSent(true)
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold">{t('auth.forgot.title')}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {sent ? (
            <p role="status">{t('auth.forgot.sent')}</p>
          ) : (
            <form onSubmit={onSubmit} className="grid gap-4">
              <p className="text-muted-foreground text-sm">{t('auth.forgot.body')}</p>
              <div className="grid gap-2">
                <Label htmlFor="email">{t('auth.forgot.email')}</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </div>
              <Button type="submit">{t('auth.forgot.submit')}</Button>
            </form>
          )}
          <Link to="/login" className="text-sm underline-offset-4 hover:underline">
            {t('auth.forgot.back')}
          </Link>
        </CardContent>
      </Card>
    </main>
  )
}
```

`apps/web/src/app/AppProviders.tsx`:
```tsx
import type { SupabaseClient } from '@supabase/supabase-js'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AuthProvider } from '@/auth/AuthProvider'
import { SupabaseContext } from '@/lib/supabase'

export function AppProviders({
  client,
  queryClient,
  children,
}: {
  client: SupabaseClient
  queryClient: QueryClient
  children: ReactNode
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <SupabaseContext value={client}>
        <AuthProvider>{children}</AuthProvider>
      </SupabaseContext>
    </QueryClientProvider>
  )
}
```

`apps/web/src/pages/SectionPage.tsx`:
```tsx
import { useTranslation } from 'react-i18next'

/** Placeholder until the section's real screen is built. */
export function SectionPage({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation()
  return (
    <section>
      <h1 className="mb-2 text-2xl font-semibold">{t(titleKey)}</h1>
      <p className="text-muted-foreground">{t('pages.comingSoon')}</p>
    </section>
  )
}
```

`apps/web/src/app/routes.tsx` (temporary minimal version — Task 5 replaces it with the full shell):
```tsx
import { Navigate, type RouteObject } from 'react-router'
import { RequireAuth } from '@/auth/RequireAuth'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage'
import { LoginPage } from '@/pages/LoginPage'
import { SectionPage } from '@/pages/SectionPage'

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      { index: true, element: <Navigate to="/quotes" replace /> },
      { path: 'quotes', element: <SectionPage titleKey="nav.quotes" /> },
      { path: 'clients', element: <SectionPage titleKey="nav.clients" /> },
    ],
  },
]
```

- [ ] **Step 5: Run tests, lint, format, commit**

```bash
npm test && npm run format && npm run lint && npm run format:check
git add apps/web
git commit -m "feat(web): add Supabase session handling, auth guard, login and password reset request"
```
Expected: all tests PASS, including the five auth tests and the forgot-password test.

---

### Task 5: Router, app shell, placeholder pages and the real App

**Files:**
- Create: `apps/web/src/app/sections.ts`, `apps/web/src/pages/NotFoundPage.tsx`, `apps/web/src/layout/AppShell.tsx`, `apps/web/src/layout/Navigation.tsx`
- Create (shadcn): `src/components/ui/sheet.tsx`
- Modify: `apps/web/src/app/routes.tsx` (replace), `apps/web/src/app/App.tsx`
- Create: `apps/web/src/app/routes.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2–4.
- Produces: `SECTIONS: { path: string; labelKey: string; icon: LucideIcon }[]` from `@/app/sections`; `<SectionPage titleKey />`; `<NotFoundPage />`; `<AppShell />` (layout route); final `routes`; `App` renders the router when env is ok.

- [ ] **Step 1: Add the Sheet component**

```bash
npx --yes shadcn@latest add sheet -c apps/web -y
```

- [ ] **Step 2: Write the failing routing tests**

`apps/web/src/app/routes.test.tsx`:
```tsx
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { fakeSession } from '@/test/fake-supabase'
import { renderApp } from '@/test/render-app'

const pages = [
  ['/quotes', 'Preventivi'],
  ['/clients', 'Clienti'],
  ['/printers', 'Stampanti'],
  ['/materials', 'Materiali'],
  ['/settings', 'Impostazioni'],
  ['/staff', 'Personale'],
  ['/account', 'Account'],
] as const

test.each(pages)('%s shows its translated title', async (path, title) => {
  renderApp(path, { session: fakeSession() })
  expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
  expect(screen.getByText('In arrivo.')).toBeInTheDocument()
})

test('root redirects to quotes', async () => {
  const { router } = renderApp('/', { session: fakeSession() })
  expect(await screen.findByRole('heading', { level: 1, name: 'Preventivi' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/quotes')
})

test('unknown paths show not found', async () => {
  renderApp('/nope', { session: fakeSession() })
  expect(await screen.findByRole('heading', { name: 'Pagina non trovata' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Torna ai preventivi' })).toHaveAttribute('href', '/quotes')
})

test('sidebar navigates between sections and marks the active one', async () => {
  const { router } = renderApp('/quotes', { session: fakeSession() })
  const nav = await screen.findByRole('navigation', { name: 'Navigazione principale' })
  await userEvent.click(within(nav).getByRole('link', { name: 'Clienti' }))
  expect(router.state.location.pathname).toBe('/clients')
  expect(within(nav).getByRole('link', { name: 'Clienti' })).toHaveAttribute('aria-current', 'page')
})

test('log out signs out and returns to login', async () => {
  const { auth, router } = renderApp('/quotes', { session: fakeSession('anna@example.com') })
  const nav = await screen.findByRole('navigation', { name: 'Navigazione principale' })
  expect(within(nav).getByText('anna@example.com')).toBeInTheDocument()
  await userEvent.click(within(nav).getByRole('button', { name: 'Esci' }))
  expect(auth.signOut).toHaveBeenCalled()
  expect(await screen.findByRole('heading', { name: 'Accedi' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/login')
})
```

Run: `npm test`
Expected: FAIL — `/printers` etc. render nothing; no navigation landmark.

- [ ] **Step 3: Implement sections, pages, shell and routes**

`apps/web/src/app/sections.ts`:
```ts
import { FileText, Layers, Printer, Settings, UserCog, Users, type LucideIcon } from 'lucide-react'

/** Sidebar sections, in order (functional analysis §2). */
export const SECTIONS: { path: string; labelKey: string; icon: LucideIcon }[] = [
  { path: '/quotes', labelKey: 'nav.quotes', icon: FileText },
  { path: '/clients', labelKey: 'nav.clients', icon: Users },
  { path: '/printers', labelKey: 'nav.printers', icon: Printer },
  { path: '/materials', labelKey: 'nav.materials', icon: Layers },
  { path: '/settings', labelKey: 'nav.settings', icon: Settings },
  { path: '/staff', labelKey: 'nav.staff', icon: UserCog },
]
```
(If an icon name doesn't exist in the installed `lucide-react`, pick the closest one from its index and ledger it.)

`apps/web/src/pages/NotFoundPage.tsx`:
```tsx
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="mb-2 text-2xl font-semibold">{t('pages.notFound.title')}</h1>
      <p className="text-muted-foreground mb-4">{t('pages.notFound.body')}</p>
      <Link to="/quotes" className="underline-offset-4 hover:underline">
        {t('pages.notFound.back')}
      </Link>
    </main>
  )
}
```

`apps/web/src/layout/Navigation.tsx`:
```tsx
import { CircleUser, LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'
import { SECTIONS } from '@/app/sections'
import { useAuth } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'
import { useSupabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { LanguageSwitcher } from './LanguageSwitcher'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm',
    isActive ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-accent/60',
  )

export function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation()
  const auth = useAuth()
  const supabase = useSupabase()

  return (
    <nav aria-label={t('nav.main')} className="flex h-full flex-col gap-4 p-3">
      <div className="px-3 pt-2 text-lg font-semibold">{t('app.name')}</div>
      <ul className="grid gap-1">
        {SECTIONS.map(({ path, labelKey, icon: Icon }) => (
          <li key={path}>
            <NavLink to={path} onClick={onNavigate} className={linkClass}>
              <Icon className="size-4" aria-hidden />
              {t(labelKey)}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="mt-auto grid gap-2 border-t pt-4">
        {auth.status === 'signedIn' && (
          <p className="text-muted-foreground truncate px-3 text-sm">{auth.session.user.email}</p>
        )}
        <div className="px-3">
          <LanguageSwitcher />
        </div>
        <NavLink to="/account" onClick={onNavigate} className={linkClass}>
          <CircleUser className="size-4" aria-hidden />
          {t('nav.account')}
        </NavLink>
        <Button
          variant="ghost"
          className="min-h-11 justify-start gap-3 px-3"
          onClick={() => void supabase.auth.signOut()}
        >
          <LogOut className="size-4" aria-hidden />
          {t('nav.logout')}
        </Button>
      </div>
    </nav>
  )
}
```

`apps/web/src/layout/AppShell.tsx`:
```tsx
import { Menu } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Navigation } from './Navigation'

/** Fixed sidebar from 1024 px; below that a top bar opens the same navigation in a drawer. */
export function AppShell() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="hidden border-r lg:block">
        <Navigation />
      </aside>
      <header className="flex items-center gap-2 border-b p-2 lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="size-11" aria-label={t('nav.menu')}>
              <Menu aria-hidden />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">{t('nav.menu')}</SheetTitle>
            <Navigation onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
        <span className="font-semibold">{t('app.name')}</span>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  )
}
```

Replace `apps/web/src/app/routes.tsx`:
```tsx
import { Navigate, type RouteObject } from 'react-router'
import { RequireAuth } from '@/auth/RequireAuth'
import { AppShell } from '@/layout/AppShell'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { SectionPage } from '@/pages/SectionPage'
import { SECTIONS } from './sections'

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/quotes" replace /> },
          ...SECTIONS.map(({ path, labelKey }) => ({
            path: path.slice(1),
            element: <SectionPage titleKey={labelKey} />,
          })),
          { path: 'account', element: <SectionPage titleKey="nav.account" /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]
```

Replace `apps/web/src/app/App.tsx`:
```tsx
import { useState } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'
import type { EnvResult, SupabaseEnv } from '@/lib/env'
import { createQueryClient } from '@/lib/query-client'
import { createSupabaseClient } from '@/lib/supabase'
import { ConfigErrorPage } from '@/pages/ConfigErrorPage'
import { AppProviders } from './AppProviders'
import { routes } from './routes'

function ConfiguredApp({ env }: { env: SupabaseEnv }) {
  const [client] = useState(() => createSupabaseClient(env))
  const [queryClient] = useState(createQueryClient)
  const [router] = useState(() => createBrowserRouter(routes))
  return (
    <AppProviders client={client} queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  )
}

export default function App({ env }: { env: EnvResult }) {
  if (!env.ok) return <ConfigErrorPage missing={env.missing} />
  return <ConfiguredApp env={env.env} />
}
```

- [ ] **Step 4: Run tests and the full gate**

```bash
npm test && npm run format && npm run lint && npm run format:check && npm run build
```
Expected: all tests PASS (env 2, App 1, i18n 5, switcher 2, auth 5, forgot 1, routes 11); lint/format clean; build succeeds.

- [ ] **Step 5: Manual smoke check**

```bash
npm run dev
```
Open the printed URL: with no `.env.local`, the "Supabase non configurato" screen lists both variables. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): add app shell, section placeholders, not-found page and router"
```

---

### Task 6: Documentation

**Files:**
- Create: `docs/frontend/web-app.md`, `docs/architecture/adr/0002-frontend-stack.md`
- Modify: `docs/development/getting-started.md`, `docs/README.md`

- [ ] **Step 1: Write `docs/frontend/web-app.md`** with sections:
  - `## Running` — `.env.local` from `.env.example` (Supabase URL + publishable key from Project Settings → API); `npm run dev|build|test|lint|format` from the root; without env the app shows the missing-config screen.
  - `## Structure` — the `src/` tree from the spec with one line per folder.
  - `## Conventions` — pages in `src/pages/` (one component per file, named `XxxPage`); every string through `t()` with keys added to **both** `it.json` and `en.json` (a test enforces it); Supabase only via `useSupabase()`; server data via TanStack Query; add UI components with `npx shadcn@latest add <name> -c apps/web` (never hand-copy); tests next to the code as `*.test.ts(x)`, using `renderApp()` and the fake Supabase client from `src/test/`.
  - `## Adding a section page` — add to `SECTIONS` in `src/app/sections.ts`, add the `nav.*` key in both catalogs, replace the `SectionPage` placeholder route with the real page.
  - `## Not done yet` — role-based hiding (needs `staff`), language persisted on the staff record, reset-password completion page (`/account` receives the recovery link), Playwright.

- [ ] **Step 2: Write `docs/architecture/adr/0002-frontend-stack.md`** (Status: Accepted, Date: 2026-10-11): Context (functional analysis needs: forms, tables, dialogs, i18n, tablet); Decision (the spec's decisions table plus: ESLint 9 not 10 because `eslint-plugin-jsx-a11y` lacks ESLint 10 support; TypeScript 6.0 from the template, within `typescript-eslint`'s range; shadcn radix/nova preset; Supabase client injected via React context); Alternatives considered (Mantine, MUI, TanStack Router, Lingui, Biome, oxlint as shipped by the template, Playwright now); Consequences (shadcn components are owned code; upgrade ESLint to 10 when jsx-a11y supports it; tests never hit a real Supabase).

- [ ] **Step 3: Update `docs/development/getting-started.md`**
  - First setup: add `cp apps/web/.env.example apps/web/.env.local` and fill it in.
  - Common commands: replace the "once the app is scaffolded" row with `npm run dev`, `npm run build`, `npm test`, `npm run lint`, `npm run format` (root, forwarded to `@3d-quote/web`).
  - Open questions: lint/format resolved for TypeScript (ESLint + Prettier, see ADR-0002); Python tooling (ruff?) and pre-commit hook remain open.

- [ ] **Step 4: Update `docs/README.md`** — add rows for [Web app](frontend/web-app.md) and note ADR-0002 under Architecture decisions.

- [ ] **Step 5: Verify links and commit**

```bash
python - <<'EOF'
import pathlib, re, sys
bad = []
for md in [pathlib.Path("README.md"), pathlib.Path("apps/web/README.md"),
           *(m for m in pathlib.Path("docs").rglob("*.md") if "superpowers" not in m.parts)]:
    text = re.sub(r"```.*?```", "", md.read_text(encoding="utf-8"), flags=re.S)
    for target in re.findall(r"\]\(([^)#\s]+)(?:#[^)]*)?\)", text):
        if "://" not in target and not (md.parent / target).exists():
            bad.append(f"{md}: {target}")
print("\n".join(bad) or "all links ok"); sys.exit(1 if bad else 0)
EOF
git add docs
git commit -m "docs: add web app guide and ADR-0002, update getting started"
```
Expected: `all links ok`.
