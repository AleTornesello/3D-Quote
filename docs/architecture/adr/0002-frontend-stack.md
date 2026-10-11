# ADR-0002: Frontend stack

- **Status: Accepted**
- **Date:** 2026-10-11

## Context

The [functional analysis](../../frontend/functional-analysis.md) asks for a staff-only web app with many forms,
tables and dialogs, Italian and English UI, desktop and tablet support, WCAG 2.1 AA as a target, and Supabase as
the backend ([ADR-0001](0001-monorepo-and-stack.md)). The app lives in `apps/web` as an npm workspace.

## Decision

| Concern | Choice |
|---|---|
| Build | Vite + React + TypeScript (from `create-vite`'s `react-ts` template) |
| UI | Tailwind CSS v4 (`@tailwindcss/vite`) + shadcn/ui, radix base, nova preset |
| Routing | React Router in SPA mode (`createBrowserRouter`) |
| Data | TanStack Query + `@supabase/supabase-js` |
| i18n | i18next + react-i18next, JSON catalogs per language |
| Tests | Vitest + Testing Library on jsdom |
| Lint / format | ESLint 9 (typescript-eslint, react-hooks, react-refresh, jsx-a11y) + Prettier |

Details:

- **ESLint 9, not 10:** `eslint-plugin-jsx-a11y` does not support ESLint 10 yet, and accessibility linting matters
  more than the newer major.
- **TypeScript 6.0:** the version `create-vite` pins; it is inside `typescript-eslint`'s supported range.
  TypeScript 7 waits for tooling support.
- **Oxlint removed:** the Vite template now ships oxlint; it was replaced by ESLint for the jsx-a11y rules.
- **Supabase client via React context:** created once per configuration and provided by `AppProviders`; components
  use `useSupabase()`. Tests inject a fake client instead of mocking modules.
- **shadcn's `cn` package** replaces `clsx` + `tailwind-merge` (installed by `shadcn init`).

## Alternatives considered

- **Mantine / MUI:** complete component libraries with less styling work, but heavier, more opinionated styling and
  harder to make the UI our own. shadcn components are plain code in the repo.
- **TanStack Router:** fully typed routes and search params, but a smaller ecosystem; React Router is enough for a
  handful of sections.
- **Lingui:** smaller runtime with compile-time extraction, at the cost of an extra build step.
- **Biome / oxlint:** much faster, but without the jsx-a11y coverage we want.
- **Playwright now:** deferred until the first real feature; unit/component tests cover the scaffold.
- **Plain supabase-js without TanStack Query:** less to learn, but caching, loading/error states and refetching
  would be hand-written on every screen.

## Consequences

- shadcn components are owned code: updates are explicit (`shadcn add --overwrite`), never automatic.
- Upgrade to ESLint 10 when `eslint-plugin-jsx-a11y` supports it; upgrade TypeScript with `typescript-eslint`.
- Tests never talk to a real Supabase; end-to-end coverage against a local Supabase comes with Playwright later.
- Every user-visible string must exist in both catalogs; a test enforces it.
