import {createHmac, timingSafeEqual} from 'node:crypto';

export interface PlaytestTicketClaims {
  assetSourceId: string;
  revision: string;
  expiresAt: number;
}

const LOCAL_SECRET = 'nock0-local-authoritative-playtest';
const DEFAULT_LIFETIME_MS = 4 * 60 * 60 * 1_000;

export function issuePlaytestTicket(
  assetSourceId: string,
  revision: string,
  now = Date.now()
): string {
  const payload = Buffer.from(JSON.stringify({
    assetSourceId,
    revision,
    expiresAt: now + DEFAULT_LIFETIME_MS
  } satisfies PlaytestTicketClaims)).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function verifyPlaytestTicket(
  token: string,
  expected: Pick<PlaytestTicketClaims, 'assetSourceId' | 'revision'>,
  now = Date.now()
): PlaytestTicketClaims {
  const [payload, suppliedSignature, extra] = token.split('.');
  if (!payload || !suppliedSignature || extra) throw new Error('Invalid Play Draft ticket.');
  const expectedSignature = signature(payload);
  const supplied = Buffer.from(suppliedSignature, 'base64url');
  const expectedBytes = Buffer.from(expectedSignature, 'base64url');
  if (supplied.length !== expectedBytes.length || !timingSafeEqual(supplied, expectedBytes)) {
    throw new Error('Invalid Play Draft ticket signature.');
  }
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PlaytestTicketClaims;
  if (
    claims.assetSourceId !== expected.assetSourceId ||
    claims.revision !== expected.revision ||
    !Number.isFinite(claims.expiresAt) ||
    claims.expiresAt <= now
  ) throw new Error('Expired or mismatched Play Draft ticket.');
  return claims;
}

function signature(payload: string): string {
  return createHmac('sha256', playtestSecret()).update(payload).digest('base64url');
}

function playtestSecret(): string {
  const configured = process.env.EDITOR_PLAYTEST_SECRET ??
    process.env.AWS_SECRET_ACCESS_KEY ??
    process.env.EDITOR_AUTH_PASSWORD;
  if (configured) return configured;
  if (process.env.NODE_ENV !== 'production') return LOCAL_SECRET;
  throw new Error('EDITOR_PLAYTEST_SECRET is required for authoritative Play Drafts.');
}
