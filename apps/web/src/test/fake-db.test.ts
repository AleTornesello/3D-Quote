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
})

describe('rpc() and storage', () => {
  test('rpc calls the handler and records arguments', async () => {
    const db = new FakeDb({}, { list_staff: () => [{ user_id: 'u' }] })
    expect((await db.rpc('list_staff')).data).toEqual([{ user_id: 'u' }])
    expect(db.rpcCalls('list_staff')).toEqual([undefined])
    expect((await db.rpc('missing')).error?.code).toBe('PGRST202')
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
