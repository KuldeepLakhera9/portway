import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-change-this-in-production';

export interface JwtPayload {
  userId: string;
  email: string | null;
  teamId: string;
  role: string;
  exp: number;
}

export function signJwt(payload: Omit<JwtPayload, 'exp'>, expiresInSeconds = 7 * 24 * 60 * 60): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const fullPayload: JwtPayload = {
    ...payload,
    exp,
  };

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadEncoded = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payloadEncoded}`)
    .digest('base64url');

  return `${header}.${payloadEncoded}.${signature}`;
}

export function verifyJwt(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [header, payloadEncoded, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payloadEncoded}`)
    .digest('base64url');

  if (signature !== expectedSignature) {
    throw new Error('Invalid JWT signature');
  }

  const payload: JwtPayload = JSON.parse(
    Buffer.from(payloadEncoded, 'base64url').toString('utf8')
  );

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) {
    throw new Error('JWT has expired');
  }

  return payload;
}
