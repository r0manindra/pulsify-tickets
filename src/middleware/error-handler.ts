import type { Context } from 'hono';
import Stripe from 'stripe';

export async function errorHandler(err: Error, c: Context) {
  console.error(`[Error] ${err.message}`, err.stack);

  if (err instanceof Stripe.errors.StripeError) {
    const status = err.statusCode ?? 500;
    return c.json(
      { error: 'Stripe error', message: err.message, code: err.code },
      status >= 500 ? 502 : (status as 400),
    );
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  return c.json({ error: 'Internal server error' }, 500);
}
