import jwt from 'jsonwebtoken'

/**
 * @param {string | undefined} token
 * @returns {{ userId: number } | null}
 */
export function verifyToken(token) {
  if (!token) {
    return null
  }

  const secret = process.env.JWT_SECRET
  if (!secret) {
    console.error('[socket] JWT_SECRET is not configured')
    return null
  }

  try {
    const payload = jwt.verify(token, secret)
    const userId = Number(payload.sub ?? payload.id)

    if (!Number.isFinite(userId) || userId <= 0) {
      return null
    }

    return { userId }
  } catch {
    return null
  }
}
