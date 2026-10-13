import { FunctionsFetchError, FunctionsHttpError, type PostgrestError } from '@supabase/supabase-js'

export type Row = Record<string, unknown>
export type Filter =
  | ['eq', string, unknown]
  | ['ilike', string, string]
  | ['or', string]
  | ['in', string, unknown[]]
  | ['gte', string, unknown]
  | ['lte', string, unknown]
export type DbOp = 'select' | 'insert' | 'update' | 'delete'
export type DbCall = { op: DbOp; filters: Filter[]; values?: unknown }
export type StorageCall = { op: 'upload' | 'remove' | 'createSignedUrl'; paths: string[] }
export type DbFailure = { code: string; message: string }

/** What a fake Edge Function answers: data, an error response with `{ code }`, or no response at all. */
export type FunctionResult =
  { data: unknown } | { status: number; code: string } | { network: true }
export type FunctionHandler = (body: unknown) => FunctionResult | Promise<FunctionResult>

/** What supabase-js returns when the request never reaches the server. */
export const NETWORK_FAILURE: DbFailure = { code: '', message: 'TypeError: Failed to fetch' }

type Result = {
  data: unknown
  error: PostgrestError | null
  count: number | null
  status: number
  statusText: string
}

function result(
  data: unknown,
  error: PostgrestError | null,
  status: number,
  count: number | null = null,
): Result {
  return { data, error, count, status, statusText: '' }
}

function postgrestError(failure: DbFailure): PostgrestError {
  return { ...failure, details: '', hint: '', name: 'PostgrestError' } as PostgrestError
}

function likeToRegExp(pattern: string) {
  const escaped = pattern.split('%').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`^${escaped.join('.*')}$`, 'i')
}

function matches(row: Row, filter: Filter): boolean {
  if (filter[0] === 'eq') return row[filter[1]] === filter[2]
  if (filter[0] === 'ilike') return likeToRegExp(filter[2]).test(String(row[filter[1]] ?? ''))
  if (filter[0] === 'in') return filter[2].includes(row[filter[1]])
  if (filter[0] === 'gte') return compare(row[filter[1]], filter[2]) >= 0
  if (filter[0] === 'lte') return compare(row[filter[1]], filter[2]) <= 0
  return filter[1].split(',').some((part) => {
    const [column, op, ...rest] = part.split('.')
    const value = rest.join('.')
    return op === 'ilike' ? matches(row, ['ilike', column, value]) : String(row[column]) === value
  })
}

function compare(a: unknown, b: unknown) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a ?? '').localeCompare(String(b ?? ''))
}

/** A chainable stand-in for a PostgREST query; awaiting it runs the query against the FakeDb. */
class FakeQuery implements PromiseLike<Result> {
  private readonly db: FakeDb
  private readonly tableName: string
  private op: DbOp = 'select'
  private values: unknown = undefined
  private filters: Filter[] = []
  private sorts: { column: string; ascending: boolean; nullsFirst: boolean }[] = []
  private window: [number, number] | null = null
  private counting = false
  private max: number | null = null
  private returning = false
  private mode: 'many' | 'single' | 'maybeSingle' = 'many'

  constructor(db: FakeDb, tableName: string) {
    this.db = db
    this.tableName = tableName
  }

  /** Columns and embeds are not interpreted: rows come back as seeded (seed embedded fields directly). */
  select(_columns?: string, options: { count?: 'exact' } = {}) {
    if (this.op !== 'select') this.returning = true
    if (options.count) this.counting = true
    return this
  }
  insert(values: Row | Row[]) {
    this.op = 'insert'
    this.values = values
    return this
  }
  update(values: Row) {
    this.op = 'update'
    this.values = values
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }
  eq(column: string, value: unknown) {
    this.filters.push(['eq', column, value])
    return this
  }
  ilike(column: string, pattern: string) {
    this.filters.push(['ilike', column, pattern])
    return this
  }
  or(expression: string) {
    this.filters.push(['or', expression])
    return this
  }
  in(column: string, values: unknown[]) {
    this.filters.push(['in', column, values])
    return this
  }
  gte(column: string, value: unknown) {
    this.filters.push(['gte', column, value])
    return this
  }
  lte(column: string, value: unknown) {
    this.filters.push(['lte', column, value])
    return this
  }
  /** Ordering inside an embedded resource (`referencedTable`) is the seed's job, so it is ignored here. */
  order(
    column: string,
    options: { ascending?: boolean; nullsFirst?: boolean; referencedTable?: string } = {},
  ) {
    if (!options.referencedTable) {
      const ascending = options.ascending ?? true
      // PostgreSQL's default: nulls sort as the largest value.
      this.sorts.push({ column, ascending, nullsFirst: options.nullsFirst ?? !ascending })
    }
    return this
  }
  range(from: number, to: number) {
    this.window = [from, to]
    return this
  }
  limit(count: number, options: { referencedTable?: string } = {}) {
    if (!options.referencedTable) this.max = count
    return this
  }
  single() {
    this.mode = 'single'
    return this
  }
  maybeSingle() {
    this.mode = 'maybeSingle'
    return this
  }

  then<A = Result, B = never>(
    onFulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onFulfilled, onRejected)
  }

  private run(): Result {
    const call: DbCall = { op: this.op, filters: this.filters }
    if (this.values !== undefined) call.values = this.values
    this.db.record(this.tableName, call)
    const failure = this.db.takeFailure(this.tableName)
    if (failure) return result(null, postgrestError(failure), 400)

    const rows = this.db.table(this.tableName)
    const matching = () => rows.filter((row) => this.filters.every((f) => matches(row, f)))
    let affected: Row[]
    if (this.op === 'insert') {
      const list = (Array.isArray(this.values) ? this.values : [this.values]) as Row[]
      affected = list.map((values) => ({ id: this.db.nextId(this.tableName), ...values }))
      rows.push(...affected)
    } else if (this.op === 'update') {
      affected = matching()
      affected.forEach((row) => Object.assign(row, this.values))
    } else if (this.op === 'delete') {
      affected = matching()
      this.db.replace(
        this.tableName,
        rows.filter((row) => !affected.includes(row)),
      )
    } else {
      affected = matching()
      affected.sort((a, b) => {
        for (const sort of this.sorts) {
          const x = a[sort.column]
          const y = b[sort.column]
          const xNull = x === null || x === undefined
          const yNull = y === null || y === undefined
          if (xNull && yNull) continue
          if (xNull || yNull) return (xNull ? -1 : 1) * (sort.nullsFirst ? 1 : -1)
          const order = compare(x, y) * (sort.ascending ? 1 : -1)
          if (order !== 0) return order
        }
        return 0
      })
      if (this.max !== null) affected = affected.slice(0, this.max)
    }
    const total = affected.length
    if (this.op === 'select' && this.window) {
      affected = affected.slice(this.window[0], this.window[1] + 1)
    }

    const data = affected.map((row) => ({ ...row }))
    if (this.op !== 'select' && !this.returning) return result(null, null, 204)
    if (this.mode === 'many') return result(data, null, 200, this.counting ? total : null)
    if (data.length === 1) return result(data[0], null, 200)
    if (data.length === 0 && this.mode === 'maybeSingle') return result(null, null, 200)
    return result(
      null,
      postgrestError({
        code: 'PGRST116',
        message: 'Cannot coerce the result to a single JSON object',
      }),
      406,
    )
  }
}

/** In-memory tables behind the fake Supabase client. Records every request so tests can assert on them. */
export class FakeDb {
  private tables: Record<string, Row[]>
  private readonly rpcs: Record<string, (args: unknown) => unknown>
  private readonly failures = new Map<string, DbFailure[]>()
  private readonly log: { table: string; call: DbCall }[] = []
  private readonly rpcLog: { fn: string; args: unknown }[] = []
  private readonly storageLog: { bucket: string; call: StorageCall }[] = []
  private readonly functions: Record<string, FunctionHandler>
  private readonly functionLog: { name: string; body: unknown }[] = []

  constructor(
    tables: Record<string, Row[]> = {},
    rpcs: Record<string, (args: unknown) => unknown> = {},
    functions: Record<string, FunctionHandler> = {},
  ) {
    this.tables = Object.fromEntries(
      Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]),
    )
    this.rpcs = rpcs
    this.functions = functions
  }

  from(table: string) {
    return new FakeQuery(this, table)
  }

  async rpc(fn: string, args?: unknown) {
    this.rpcLog.push({ fn, args })
    const failure = this.takeFailure(fn)
    if (failure) return result(null, postgrestError(failure), 400)
    const handler = this.rpcs[fn]
    if (!handler) {
      return result(
        null,
        postgrestError({ code: 'PGRST202', message: `Could not find the function public.${fn}` }),
        404,
      )
    }
    return result(await handler(args), null, 200)
  }

  /** Answers like `supabase.functions.invoke`: `{ data, error }` with supabase-js's own error classes. */
  async invoke(name: string, body: unknown) {
    this.functionLog.push({ name, body })
    const handler = this.functions[name]
    const answer: FunctionResult = handler
      ? await handler(body)
      : { status: 404, code: 'not_found' }
    if ('data' in answer) return { data: answer.data, error: null }
    if ('network' in answer) {
      return { data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) }
    }
    const response = new Response(JSON.stringify({ code: answer.code }), {
      status: answer.status,
      headers: { 'Content-Type': 'application/json' },
    })
    return { data: null, error: new FunctionsHttpError(response) }
  }

  functionCalls(name: string): unknown[] {
    return this.functionLog.filter((entry) => entry.name === name).map((entry) => entry.body)
  }

  readonly storage = {
    from: (bucket: string) => ({
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      upload: async (path: string, _file: Blob, _options?: unknown) =>
        this.storageOp(bucket, { op: 'upload', paths: [path] }, { path }),
      remove: async (paths: string[]) => this.storageOp(bucket, { op: 'remove', paths }, []),
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      createSignedUrl: async (path: string, _expiresIn: number) =>
        this.storageOp(
          bucket,
          { op: 'createSignedUrl', paths: [path] },
          { signedUrl: `https://storage.test/${bucket}/${path}` },
        ),
    }),
  }

  /** The next request to `target` (a table, an rpc function name or `storage:<bucket>`) fails with `failure`. */
  failNext(target: string, failure: DbFailure) {
    this.failures.set(target, [...(this.failures.get(target) ?? []), failure])
  }

  calls(table: string): DbCall[] {
    return this.log.filter((entry) => entry.table === table).map((entry) => entry.call)
  }

  rpcCalls(fn: string): unknown[] {
    return this.rpcLog.filter((entry) => entry.fn === fn).map((entry) => entry.args)
  }

  storageCalls(bucket: string): StorageCall[] {
    return this.storageLog.filter((entry) => entry.bucket === bucket).map((entry) => entry.call)
  }

  table(name: string): Row[] {
    return (this.tables[name] ??= [])
  }

  /** @internal used by FakeQuery */
  replace(name: string, rows: Row[]) {
    this.tables[name] = rows
  }

  /** @internal used by FakeQuery */
  record(table: string, call: DbCall) {
    this.log.push({ table, call })
  }

  /** @internal used by FakeQuery */
  takeFailure(target: string) {
    return this.failures.get(target)?.shift()
  }

  /** @internal used by FakeQuery */
  nextId(name: string) {
    const ids = this.table(name)
      .map((row) => row.id)
      .filter((id): id is number => typeof id === 'number')
    return ids.length ? Math.max(...ids) + 1 : 1
  }

  private storageOp(bucket: string, call: StorageCall, data: unknown) {
    this.storageLog.push({ bucket, call })
    const failure = this.takeFailure(`storage:${bucket}`)
    if (failure) return { data: null, error: { name: 'StorageError', message: failure.message } }
    return { data, error: null }
  }
}
