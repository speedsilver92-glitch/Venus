import jwt from 'jsonwebtoken';

const secret = () => process.env.JWT_SECRET || 'privora-dev-secret-change-me';

export function signToken(user, sessionId = null) {
  return jwt.sign({ sub: user.id, username: user.username, sid: sessionId }, secret(), { expiresIn: '30d' });
}

export function verifyToken(token) {
  return jwt.verify(token, secret());
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  try {
    req.auth = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
}
