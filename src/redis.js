import Redis from 'ioredis'

const REDIS_RETRY_MS = 5000

/**
 * @param {{
 *   host: string
 *   port: number
 *   password?: string
 *   channel: string
 *   onMessage: (message: Record<string, unknown>) => void
 *   onStatus?: (connected: boolean) => void
 * }} options
 */
export function createRedisSubscriber(options) {
  const { host, port, password, channel, onMessage, onStatus } = options
  let subscriber = null
  let stopped = false

  function buildClient() {
    return new Redis({
      host,
      port,
      password: password || undefined,
      lazyConnect: true,
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    })
  }

  async function subscribe() {
    while (!stopped) {
      try {
        subscriber?.disconnect()
        subscriber = buildClient()
        subscriber.on('error', (error) => {
          console.error('[socket] redis error:', error.message)
          onStatus?.(false)
        })

        await subscriber.connect()
        await subscriber.subscribe(channel)
        onStatus?.(true)
        console.info(`[socket] subscribed redis channel ${channel} (${host}:${port})`)

        subscriber.on('message', (_redisChannel, raw) => {
          try {
            onMessage(JSON.parse(raw))
          } catch (error) {
            console.error('[socket] invalid redis payload:', error.message)
          }
        })

        await new Promise((resolve, reject) => {
          subscriber.once('end', resolve)
          subscriber.once('error', reject)
        })
      } catch (error) {
        onStatus?.(false)
        console.warn(
          `[socket] redis unavailable — retry in ${REDIS_RETRY_MS / 1000}s:`,
          error.message,
        )
        await new Promise((resolve) => setTimeout(resolve, REDIS_RETRY_MS))
      }
    }
  }

  subscribe()

  return {
    stop() {
      stopped = true
      subscriber?.disconnect()
    },
    get connected() {
      return subscriber?.status === 'ready'
    },
  }
}
