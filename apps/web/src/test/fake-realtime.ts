import { act } from '@testing-library/react'

type Callback = (payload: unknown) => void
type Listener = { table: string; filter?: string; callback: Callback }

class FakeChannel {
  readonly name: string
  readonly listeners: Listener[] = []
  private onStatus: ((status: string) => void) | undefined

  constructor(name: string) {
    this.name = name
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
    queueMicrotask(() => onStatus?.('SUBSCRIBED'))
    return this
  }

  /** @internal used by FakeRealtime */
  status(status: string) {
    this.onStatus?.(status)
  }
}

/** Stands in for supabase.channel(): tests deliver changes and reconnects by hand. */
export class FakeRealtime {
  readonly channels: FakeChannel[] = []

  readonly channel = (name: string) => {
    const channel = new FakeChannel(name)
    this.channels.push(channel)
    return channel
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

  /** Delivers a change on `table` to every open listener. */
  emit(table: string) {
    return act(async () => {
      for (const channel of [...this.channels]) {
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
