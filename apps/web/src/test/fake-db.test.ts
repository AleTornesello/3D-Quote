import { describe, expect, test } from 'vitest'
import { FakeDb, NETWORK_FAILURE } from './fake-db'

const seed = () =>
  new FakeDb({
    printers: [
      { id: 1, name: 'MK4', active: true },
      { id: 2, name: 'X1C', active: false },
    ],
  })

describe('from()', () => {
  test('select filters, orders and records the call', async () => {
    const db = seed()
    const { data, error } = await db.from('printers').select('*').eq('active', true).order('name')
    expect(error).toBeNull()
    expect(data).toEqual([{ id: 1, name: 'MK4', active: true }])
    expect(db.calls('printers')).toEqual([{ op: 'select', filters: [['eq', 'active', true]] }])
  })

  test('order descending and limit', async () => {
    const { data } = await seed()
      .from('printers')
      .select('*')
      .order('name', { ascending: false })
      .limit(1)
    expect(data).toEqual([{ id: 2, name: 'X1C', active: false }])
  })

  test('ilike and or match case-insensitively', async () => {
    const db = seed()
    expect((await db.from('printers').select('*').ilike('name', '%mk%')).data).toHaveLength(1)
    const { data } = await db.from('printers').select('*').or('name.ilike.%x1%,name.ilike.%zz%')
    expect(data).toEqual([{ id: 2, name: 'X1C', active: false }])
  })

  test('insert assigns the next id and returns the row', async () => {
    const db = seed()
    const { data } = await db.from('printers').insert({ name: 'New' }).select().single()
    expect(data).toEqual({ id: 3, name: 'New' })
    expect(db.table('printers')).toHaveLength(3)
    expect(db.calls('printers')).toContainEqual({
      op: 'insert',
      values: { name: 'New' },
      filters: [],
    })
  })

  test('update changes matching rows', async () => {
    const db = seed()
    const { data } = await db
      .from('printers')
      .update({ active: true })
      .eq('id', 2)
      .select()
      .single()
    expect(data).toEqual({ id: 2, name: 'X1C', active: true })
    expect(db.calls('printers')).toContainEqual({
      op: 'update',
      values: { active: true },
      filters: [['eq', 'id', 2]],
    })
  })

  test('single with no match fails with PGRST116, maybeSingle returns null', async () => {
    const db = seed()
    const single = await db.from('printers').update({ name: 'x' }).eq('id', 9).select().single()
    expect(single.error?.code).toBe('PGRST116')
    const maybe = await db.from('printers').select('*').eq('id', 9).maybeSingle()
    expect(maybe).toMatchObject({ data: null, error: null })
  })

  test('delete removes rows and returns them when selected', async () => {
    const db = seed()
    const { data } = await db.from('printers').delete().eq('id', 1).select('id')
    expect(data).toEqual([{ id: 1, name: 'MK4', active: true }])
    expect(db.table('printers')).toHaveLength(1)
  })

  test('failNext fails only the next request to that table', async () => {
    const db = seed()
    db.failNext('printers', NETWORK_FAILURE)
    expect((await db.from('printers').select('*')).error?.message).toBe(
      'TypeError: Failed to fetch',
    )
    expect((await db.from('printers').select('*')).error).toBeNull()
  })
  test('in, gte and lte filter and are recorded', async () => {
    const db = new FakeDb({
      quotes: [
        { id: 1, status: 'draft', day: '2026-10-01' },
        { id: 2, status: 'sent', day: '2026-10-05' },
        { id: 3, status: 'expired', day: '2026-10-09' },
      ],
    })
    const { data } = await db
      .from('quotes')
      .select('*')
      .in('status', ['sent', 'expired'])
      .gte('day', '2026-10-02')
      .lte('day', '2026-10-05')
    expect(data).toEqual([{ id: 2, status: 'sent', day: '2026-10-05' }])
    expect(db.calls('quotes')[0].filters).toEqual([
      ['in', 'status', ['sent', 'expired']],
      ['gte', 'day', '2026-10-02'],
      ['lte', 'day', '2026-10-05'],
    ])
  })

  test('orders by several columns with nulls last by default when ascending', async () => {
    const db = new FakeDb({
      t: [
        { id: 1, a: 1, b: null },
        { id: 2, a: 1, b: 5 },
        { id: 3, a: 0, b: 9 },
      ],
    })
    const asc = await db.from('t').select('*').order('a').order('b')
    expect((asc.data as { id: number }[]).map((r) => r.id)).toEqual([3, 2, 1])
    const desc = await db.from('t').select('*').order('b', { ascending: false, nullsFirst: false })
    expect((desc.data as { id: number }[]).map((r) => r.id)).toEqual([3, 2, 1])
  })

  test('range returns a window and count the full total', async () => {
    const db = new FakeDb({ t: [1, 2, 3, 4, 5].map((id) => ({ id })) })
    const { data, count } = await db
      .from('t')
      .select('*', { count: 'exact' })
      .order('id')
      .range(1, 2)
    expect(data).toEqual([{ id: 2 }, { id: 3 }])
    expect(count).toBe(5)
  })
})

describe('rpc() and storage', () => {
  test('rpc calls the handler and records arguments', async () => {
    const db = new FakeDb({}, { list_staff: () => [{ user_id: 'u' }] })
    expect((await db.rpc('list_staff')).data).toEqual([{ user_id: 'u' }])
    expect(db.rpcCalls('list_staff')).toEqual([undefined])
    expect((await db.rpc('missing')).error?.code).toBe('PGRST202')
  })

  test('rpc awaits async handlers', async () => {
    const db = new FakeDb({}, { list_staff: async () => [{ user_id: 'u' }] })
    expect((await db.rpc('list_staff')).data).toEqual([{ user_id: 'u' }])
  })

  test('storage records uploads, removals and signed URLs', async () => {
    const db = new FakeDb()
    const bucket = db.storage.from('branding')
    expect((await bucket.upload('logo.png', new Blob(['x']))).data).toEqual({ path: 'logo.png' })
    await bucket.remove(['old.png'])
    expect((await bucket.createSignedUrl('logo.png', 3600)).data).toEqual({
      signedUrl: 'https://storage.test/branding/logo.png',
    })
    expect(db.storageCalls('branding')).toEqual([
      { op: 'upload', paths: ['logo.png'] },
      { op: 'remove', paths: ['old.png'] },
      { op: 'createSignedUrl', paths: ['logo.png'] },
    ])
  })
})

test('configure() fills insert defaults and embeds rows on select', async () => {
  const db = new FakeDb({ clients: [{ id: 1, name: 'Mario' }] }).configure({
    defaults: { quotes: () => ({ status: 'draft' }) },
    embeds: {
      quotes: (row, fake) => ({
        client: fake.table('clients').find((c) => c.id === row.client_id),
      }),
    },
  })
  await db.from('quotes').insert({ client_id: 1 })
  const { data } = await db.from('quotes').select('*').single()
  expect(data).toEqual({ id: 1, status: 'draft', client_id: 1, client: { id: 1, name: 'Mario' } })
  expect(db.calls('quotes')[0]).toEqual({ op: 'insert', filters: [], values: { client_id: 1 } })
})
