import type { Context, Next } from 'hono';
import { createMiddleware } from 'hono/factory';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';
import { config } from '../config.js';
import type { AuthPayload } from '../types/index.js';

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthPayload;
  }
}

/** Middleware: requires a valid API key (org-level access) */
export const requireApiKey = createMiddleware(async (c: Context, next: Next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing Authorization header' }, 401);
  }

  const token = header.slice(7);

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.apiKey, token))
    .limit(1);

  if (!org) {
    return c.json({ error: 'Invalid API key' }, 401);
  }

  c.set('auth', { type: 'api_key', organizationId: org.id });
  await next();
});

/** Middleware: requires a valid JWT (end-user access) */
export const requireJwt = createMiddleware(async (c: Context, next: Next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing Authorization header' }, 401);
  }

  const token = header.slice(7);

  try {
    const payload = jwt.verify(token, config.jwt.secret) as { sub: string; [key: string]: unknown };
    c.set('auth', { type: 'jwt', userId: payload.sub });
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  await next();
});

/** Middleware: accepts API key OR JWT (for org bootstrap from mobile/dashboard) */
export const requireApiKeyOrJwt = createMiddleware(async (c: Context, next: Next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing Authorization header' }, 401);
  }

  const token = header.slice(7);

  // Try API key first
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.apiKey, token))
    .limit(1);

  if (org) {
    c.set('auth', { type: 'api_key', organizationId: org.id });
    return next();
  }

  // Fall back to JWT — just verify it's valid, no org claim needed
  try {
    const payload = jwt.verify(token, config.jwt.secret) as { sub: string; organizationId?: string; [key: string]: unknown };
    c.set('auth', { type: 'jwt', userId: payload.sub, organizationId: payload.organizationId });
  } catch {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  await next();
});

/** Middleware: requires admin secret (for creating orgs) */
export const requireAdmin = createMiddleware(async (c: Context, next: Next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing Authorization header' }, 401);
  }

  const token = header.slice(7);
  if (token !== config.adminSecret) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  await next();
});
