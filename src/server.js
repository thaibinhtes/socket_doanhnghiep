import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import { verifyToken } from './auth.js'
import { createRedisSubscriber } from './redis.js'

const port = Number(process.env.SOCKET_PORT ?? 3001)
const redisHost = process.env.REDIS_HOST ?? '127.0.0.1'
const redisPort = Number(process.env.REDIS_PORT ?? 6379)
const redisChannel = process.env.REDIS_CHANNEL ?? 'mobi:import-events'
const internalSecret = process.env.INTERNAL_SECRET ?? 'mobi-socket-internal'
const corsOrigins = (process.env.SOCKET_CORS_ORIGIN ?? 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

let redisConnected = false

const app = express()
app.use(cors({ origin: corsOrigins }))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'mobi-socket',
    redis: redisConnected ? 'connected' : 'disconnected',
    redisHost,
    redisPort,
    channel: redisChannel,
  })
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

createRedisSubscriber({
  host: redisHost,
  port: redisPort,
  password: process.env.REDIS_PASSWORD,
  channel: redisChannel,
  onMessage: handleImportEvent,
  onStatus: (connected) => {
    redisConnected = connected
  },
})

httpServer.listen(port, () => {
  console.info(`[socket] listening on :${port}`)
  console.info(`[socket] redis target ${redisHost}:${redisPort} channel ${redisChannel}`)
})
