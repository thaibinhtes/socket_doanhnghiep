import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import Redis from 'ioredis'
import { verifyToken } from './auth.js'

const port = Number(process.env.SOCKET_PORT ?? 6001)
const redisChannel = process.env.REDIS_CHANNEL ?? 'mobi:import-events'
const internalSecret = process.env.INTERNAL_SECRET ?? 'mobi-socket-internal'
const corsOrigins = (process.env.SOCKET_CORS_ORIGIN ?? 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const app = express()
app.use(cors({ origin: corsOrigins }))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'mobi-socket' })
})

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: corsOrigins,
    credentials: true,
  },
  path: '/socket.io',
})

/**
 * @param {number} userId
 * @param {string} topic
 * @param {Record<string, unknown>} payload
 */
function emitToUser(userId, topic, payload) {
  io.to(`user:${userId}`).emit(topic, payload)
  console.info(`[socket] emit ${topic} → user:${userId}`)
}

/**
 * @param {Record<string, unknown>} message
 */
function handleImportEvent(message) {
  const userId = Number(message.userId)
  const topic = String(message.topic ?? '')
  const payload = message.payload ?? {}

  if (!Number.isFinite(userId) || userId <= 0 || topic === '') {
    return
  }

  emitToUser(userId, topic, {
    ...payload,
    topic,
    userId,
    importJobId: message.importJobId ?? null,
    timestamp: message.timestamp ?? new Date().toISOString(),
  })
}

io.use((socket, next) => {
  const token = socket.handshake.auth?.token ?? socket.handshake.query?.token
  const auth = verifyToken(typeof token === 'string' ? token : undefined)

  if (!auth) {
    return next(new Error('Unauthorized'))
  }

  socket.data.userId = auth.userId
  next()
})

io.on('connection', (socket) => {
  const userId = socket.data.userId
  socket.join(`user:${userId}`)
  console.info(`[socket] connected user:${userId} (${socket.id})`)

  socket.on('disconnect', () => {
    console.info(`[socket] disconnected user:${userId} (${socket.id})`)
  })
})

app.post('/internal/notify', (req, res) => {
  const secret = req.header('X-Internal-Secret')

  if (secret !== internalSecret) {
    return res.status(403).json({ message: 'Forbidden' })
  }

  handleImportEvent(req.body ?? {})
  return res.json({ ok: true })
})

const redis = new Redis({
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  lazyConnect: true,
  maxRetriesPerRequest: null,
})

redis.on('error', (error) => {
  console.error('[socket] redis error:', error.message)
})

async function subscribeRedis() {
  try {
    await redis.connect()
    const subscriber = redis.duplicate()
    await subscriber.connect()
    await subscriber.subscribe(redisChannel)
    subscriber.on('message', (_channel, raw) => {
      try {
        handleImportEvent(JSON.parse(raw))
      } catch (error) {
        console.error('[socket] invalid redis payload:', error.message)
      }
    })
    console.info(`[socket] subscribed redis channel ${redisChannel}`)
  } catch (error) {
    console.warn('[socket] redis unavailable — HTTP /internal/notify fallback only:', error.message)
  }
}

subscribeRedis()

httpServer.listen(port, () => {
  console.info(`[socket] listening on :${port}`)
})
