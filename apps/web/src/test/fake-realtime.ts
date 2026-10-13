import { act } from '@testing-library/react'

type Callback = (payload: unknown) => void
type Listener = { table: string; filter?: string; callback: Callback }

class FakeChannel {
  readonly name: string
  readonly listeners: Listener[] = []
  /** Like the real thing, a channel delivers changes only while subscribed. */
  subscribed = false
  private readonly realtime: FakeRealtime
  private onStatus: ((status: string) => void) | undefined

  constructor(name: string, realtime: FakeRealtime) {
    this.name = name
    this.realtime = realtime
  }

  on(
    _type: 'postgres_changes',
    options: { event: string; schema: string; table: string; filter?: string },
    callback: Callback,
  ) {
    this.listeners.push({ table: options.table, filter: options.filter, callback })
    return this
  }

  subscribe(onStatus?: (status: string) => void) {
    this.onStatus = onStatus
    if (!this.realtime.holdSubscription(this)) queueMicrotask(() => this.status('SUBSCRIBED'))
    return this
  }

  /** @internal used by FakeRealtime */
  status(status: string) {
    this.subscribed = status === 'SUBSCRIBED'
    this.onStatus?.(status)
  }
}

/** Stands in for supabase.channel(): tests deliver changes and reconnects by hand. */
export class FakeRealtime {
  readonly channels: FakeChannel[] = []
  private held: FakeChannel[] | null = null

  readonly channel = (name: string) => {
    const channel = new FakeChannel(name, this)
    this.channels.push(channel)
    return channel
  }

  /** New subscriptions stay pending (receiving nothing) until `release()`. */
  hold() {
    this.held = []
  }

  /** Completes the subscriptions held since `hold()`. */
  release() {
    return act(async () => {
      const held = this.held ?? []
      this.held = null
      for (const channel of held) if (this.channels.includes(channel)) channel.status('SUBSCRIBED')
    })
  }

  /** @internal used by FakeChannel: true when the subscription is held. */
  holdSubscription(channel: FakeChannel) {
    this.held?.push(channel)
    return this.held !== null
  }

  readonly removeChannel = async (channel: FakeChannel) => {
    const index = this.channels.indexOf(channel)
    if (index >= 0) this.channels.splice(index, 1)
    return 'ok' as const
  }

  /** The filters of the open listeners on `table`. */
  filters(table: string) {
    return this.channels.flatMap((channel) =>
      channel.listeners.filter((l) => l.table === table).map((l) => l.filter),
    )
  }

  /** Delivers a change on `table` to every listener of a subscribed channel. */
  emit(table: string) {
    return act(async () => {
      for (const channel of this.channels.filter((c) => c.subscribed)) {
        for (const listener of channel.listeners) {
          if (listener.table === table) listener.callback({ table, eventType: 'UPDATE' })
        }
      }
    })
  }

  /** Every open channel drops and comes back. */
  reconnect() {
    return act(async () => {
      for (const channel of [...this.channels]) {
        channel.status('CHANNEL_ERROR')
        channel.status('SUBSCRIBED')
      }
    })
  }
}
