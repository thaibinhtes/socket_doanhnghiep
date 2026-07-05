/**
 * "redis" chỉ resolve được trong Docker Compose network.
 * Chạy npm/node trực tiếp trên VPS → dùng 127.0.0.1.
 */
export function resolveRedisHost() {
  const configured = (process.env.REDIS_HOST ?? '127.0.0.1').trim()

  if (configured === 'redis' && process.env.RUNNING_IN_DOCKER !== '1') {
    console.warn('[socket] REDIS_HOST=redis nhưng không chạy trong Docker → dùng 127.0.0.1')
    return '127.0.0.1'
  }

  return configured || '127.0.0.1'
}
