// Regenerates src/lib/database.types.ts from the local Supabase database (`supabase start` must be running).
// With --check it writes nothing and fails when the committed file is out of date.
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as prettier from 'prettier'

const webRoot = path.resolve(import.meta.dirname, '..')
const repoRoot = path.resolve(webRoot, '../..')
const target = path.join(webRoot, 'src/lib/database.types.ts')

const raw = execSync('supabase gen types typescript --local', {
  cwd: repoRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})
const options = (await prettier.resolveConfig(target)) ?? {}
const formatted = await prettier.format(raw, { ...options, filepath: target })

if (process.argv.includes('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : ''
  if (current !== formatted) {
    console.error('src/lib/database.types.ts is out of date: run `npm run gen:types`.')
    process.exit(1)
  }
  console.log('src/lib/database.types.ts is up to date.')
} else {
  writeFileSync(target, formatted)
  console.log('Wrote src/lib/database.types.ts')
}
