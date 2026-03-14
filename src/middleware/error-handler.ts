import type { Context } from 'hono';
import { TitoApiError } from '../services/tito.js';

export async function errorHandler(err: Error, c: Context) {
  console.error(`[Error] ${err.message}`, err.stack);

  if (err instanceof TitoApiError) {
    return c.json(
      { error: 'Tito API error', details: err.body, status: err.status },
      err.status >= 500 ? 502 : err.status as 400,
    );
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  return c.json({ error: 'Internal server error' }, 500);
}
