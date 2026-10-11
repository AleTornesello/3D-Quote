# Web App Scaffold — Design

- **Date:** 2026-10-11
- **Status:** Draft — awaiting review
- **Branch:** `develop`

## Goal

Create `apps/web` as a working foundation for the screens in the
[web app functional analysis](../../frontend/functional-analysis.md): toolchain, routing, i18n, Supabase auth, app
shell and placeholder pages, with tests, lint and formatting in place. No business features.

## Decisions

| Concern | Choice |
|---|---|
| Build | Vite + React + TypeScript (`react-ts` template from `create-vite`) |
| UI | Tailwind CSS v4 via `@tailwindcss/vite`, shadcn/ui components |
| Routing | React Router, SPA (library) mode |
| Data | TanStack Query + `@supabase/supabase-js` |
| i18n | i18next + react-i18next; catalogs `it.json`, `en.json` |
| Tests | Vitest + Testing Library, jsdom |
| Lint / format | ESLint (template config + `eslint-plugin-jsx-a11y`) + Prettier |
| Package | npm workspace `@3d-quote/web`, private |

Versions are whatever npm resolves as latest when the scaffold is created, as long as `build`, `lint` and `test`
pass together. Known risk: TypeScript 7 (current major) may not yet be supported by `typescript-eslint`; if so,
pin TypeScript to the latest 5.x and record it in ADR-0002.

## Structure

```
apps/web/
├── package.json              # @3d-quote/web
├── index.html
├── vite.config.ts            # react + tailwind plugins, @ alias → src, vitest config
├── tsconfig*.json            # template files + "@/*" path alias
├── eslint.config.js
├── .prettierrc.json, .prettierignore
├── components.json           # shadcn config
├── .env.example              # VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
└── src/
    ├── main.tsx
    ├── index.css             # tailwind + shadcn theme tokens
    ├── app/                  # App (providers), router
    ├── lib/                  # env, supabase client, query client, utils (cn)
    ├── i18n/                 # i18n setup, locales/it.json, locales/en.json
    ├── auth/                 # AuthProvider, useSession, RequireAuth
    ├── layout/               # AppShell, Sidebar nav, LanguageSwitcher
    ├── pages/                # LoginPage, ForgotPasswordPage, placeholder section pages, NotFoundPage
    ├── components/ui/        # shadcn components, added only when used
    └── test/setup.ts         # jest-dom matchers, i18n init for tests
```

## Behaviour

**Configuration**
- `src/lib/env.ts` reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. If either is missing or empty,
  the app renders a "Supabase is not configured" screen naming the missing variable(s) and pointing to
  `apps/web/.env.example`; no Supabase client is created.

**Auth**
- `AuthProvider` loads the current session (`supabase.auth.getSession`) and subscribes to
  `onAuthStateChange`. While the session is loading, protected routes show a loading state, not the login page.
- `RequireAuth` wraps every route except `/login` and `/forgot-password`; without a session it redirects to
  `/login`, remembering the requested path and returning there after login.
- **Login** (`/login`): email + password, both required; submit calls `signInWithPassword`. On failure it shows a
  translated error under the form; on success it navigates to the remembered path or `/quotes`. Already-logged-in
  users visiting `/login` go to `/quotes`. Link to forgot password.
- **Forgot password** (`/forgot-password`): email field; calls `resetPasswordForEmail` and always shows the same
  confirmation text (does not reveal whether the email exists).
- **Log out**: in the sidebar; calls `signOut`, then the guard sends the user to `/login`.

**Routes**

| Path | Page |
|---|---|
| `/` | redirect to `/quotes` |
| `/quotes`, `/clients`, `/printers`, `/materials`, `/settings`, `/staff`, `/account` | placeholder: translated title + "Coming soon" |
| `/login`, `/forgot-password` | public |
| anything else | Not found page with a link to `/quotes` |

**App shell** (functional analysis §2)
- ≥ 1024 px: fixed sidebar with the sections above (Quotes … Staff), and at the bottom the user's email, language
  switcher, Account link and Log out.
- < 1024 px: a top bar with a menu button opening the same navigation in a drawer (shadcn Sheet); the drawer closes
  on navigation.
- The active section is highlighted; navigation links are real links (`<a href>`), keyboard reachable.
- Role-based hiding (Staff, owner-only actions) is not implemented yet; it needs the `staff` table.

**i18n**
- Initial language: `localStorage` value if present, else the browser language if it starts with `it` or `en`,
  else `it`.
- Switching language updates all text immediately, sets `<html lang>`, and stores the choice in `localStorage`
  (wrapped in try/catch; storage failures are ignored). Moves to `staff.language` once the schema exists.
- Every user-visible string is in both catalogs; a test asserts the two catalogs have the same keys.

## Scripts

`apps/web/package.json`: `dev`, `build` (`tsc -b && vite build`), `preview`, `test` (`vitest run`),
`test:watch`, `lint` (`eslint .`), `format` (`prettier --write .`), `format:check`.

Root `package.json`: `dev`, `build`, `test`, `lint`, `format`, `format:check`, each running the same script with
`--workspace @3d-quote/web`.

## Tests

With the Supabase client mocked:

1. Missing env → "not configured" screen lists the missing variable.
2. No session → visiting `/clients` redirects to `/login`.
3. Login submits email + password to `signInWithPassword`; on success lands on the remembered path.
4. Login failure shows the error message and stays on `/login`.
5. Forgot password calls `resetPasswordForEmail` and shows the confirmation.
6. With a session, each section route renders its translated title; unknown path renders Not found.
7. Language switcher changes visible text from Italian to English and persists the choice.
8. `it.json` and `en.json` have identical key sets.

Done means: `npm run build`, `npm run lint`, `npm run format:check` and `npm test` all pass from the repository
root.

## Docs

- `docs/frontend/web-app.md`: code structure, conventions (where pages go, adding translations, adding a shadcn
  component, env setup), and how to run.
- `docs/architecture/adr/0002-frontend-stack.md`: the decisions table above, alternatives considered (Mantine/MUI,
  TanStack Router, Lingui, Biome, Playwright now), consequences.
- `docs/development/getting-started.md`: web app commands, `.env` setup, and the lint/format open question
  resolved (ESLint + Prettier for TypeScript; Python tooling still open).
- `docs/README.md`: link to `frontend/web-app.md` and the new ADR.

## Out of scope

Supabase schema and `supabase init`, real features, role-based UI, Playwright, CI, deployment.

## Git

All commits on `develop`. Pushing `develop` to `origin` is a separate step, done only when asked.
