import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { orders, tickets, organizations } from '../db/schema.js';
import { constructWebhookEvent } from '../services/stripe.js';

const app = new Hono();

// POST /webhooks/stripe — receive Stripe webhook events
app.post('/stripe', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('stripe-signature');

  if (!signature) {
    return c.json({ error: 'Missing signature' }, 400);
  }

  let event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (err) {
    console.error('[Webhook] Signature verification failed:', err);
    return c.json({ error: 'Invalid signature' }, 401);
  }

  console.log(`[Webhook] Received: ${event.type}`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const orderId = session.metadata?.orderId;
        if (!orderId) break;

        // Activate the order
        await db
          .update(orders)
          .set({
            status: 'complete',
            stripePaymentIntentId: typeof session.payment_intent === 'string'
              ? session.payment_intent
              : null,
          })
          .where(eq(orders.id, orderId));

        // Activate all tickets for this order
        await db
          .update(tickets)
          .set({ status: 'active' })
          .where(eq(tickets.orderId, orderId));

        console.log(`[Webhook] Order ${orderId} completed`);
        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object;
        const orderId = session.metadata?.orderId;
        if (!orderId) break;

        // Cancel the order
        await db
          .update(orders)
          .set({ status: 'cancelled' })
          .where(eq(orders.id, orderId));

        // Cancel all tickets for this order
        await db
          .update(tickets)
          .set({ status: 'cancelled' })
          .where(eq(tickets.orderId, orderId));

        console.log(`[Webhook] Order ${orderId} expired/cancelled`);
        break;
      }

      case 'account.updated': {
        const account = event.data.object;
        if (account.charges_enabled) {
          await db
            .update(organizations)
            .set({ stripeOnboardingComplete: true })
            .where(eq(organizations.stripeConnectedAccountId, account.id));
          console.log(`[Webhook] Account ${account.id} onboarding complete`);
        }
        break;
      }

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`[Webhook] Error processing ${event.type}:`, err);
  }

  return c.json({ received: true });
});

export default app;
