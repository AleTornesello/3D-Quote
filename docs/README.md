# 3D-Quote documentation

3D-Quote is an internal tool for a 3D print shop. Staff upload a client's model, the system slices it to get
print time and filament usage, and a quote is produced from those numbers plus the shop's material and machine
rates. Data, files, authentication and the API live on Supabase; slicing runs in a Python worker.

## Sections

| Section | What you'll find |
|---|---|
| [Product overview](product/overview.md) | What the tool does, who uses it, the quoting workflow, glossary |
| [Architecture overview](architecture/overview.md) | Components, data flow, job lifecycle, security |
| [Architecture decisions](architecture/adr/) | ADRs — why the stack and structure are what they are |
| [slicer-worker](services/slicer-worker.md) | The Python slicing service: job contract, processing loop, configuration |
| [Data model](supabase/data-model.md) | Draft Postgres schema, Storage layout, queues, access rules |
| [Web app functional analysis](frontend/functional-analysis.md) | Roles, screens, quote lifecycle, pricing rules, PDF, i18n |
| [Getting started](development/getting-started.md) | Prerequisites, local setup, common commands |
| [Specs](superpowers/specs/) | Design specs written before implementation work |
| [Plans](superpowers/plans/) | Implementation plans derived from the specs |

## Conventions

- Docs are written in English.
- One topic per file; link to other pages instead of repeating them.
- Anything not yet decided goes under an `## Open questions` heading in the page it affects, never stated as fact.
- Architecture decisions are recorded as ADRs in `architecture/adr/`, named `NNNN-kebab-title.md`
  (e.g. `0001-monorepo-and-stack.md`), and are not rewritten once accepted — a later ADR supersedes them.
- Diagrams use Mermaid code blocks so they render on GitHub and stay diffable.
