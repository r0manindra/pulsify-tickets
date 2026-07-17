import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { orders, tickets, ticketTypes, organizations } from '../db/schema.js';
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

        // Guarded pending→complete transition makes Stripe redeliveries no-ops.
        await db.transaction(async (tx) => {
          const [order] = await tx
            .update(orders)
            .set({
              status: 'complete',
              stripePaymentIntentId: typeof session.payment_intent === 'string'
                ? session.payment_intent
                : null,
            })
            .where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
            .returning();
          if (!order) return;

          await tx
            .update(tickets)
            .set({ status: 'active' })
            .where(and(eq(tickets.orderId, orderId), eq(tickets.status, 'pending')));
        });

        console.log(`[Webhook] Order ${orderId} completed`);
        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object;
        const orderId = session.metadata?.orderId;
        if (!orderId) break;

        await db.transaction(async (tx) => {
          const [order] = await tx
            .update(orders)
            .set({ status: 'cancelled' })
            .where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
            .returning();
          if (!order) return;

          const cancelled = await tx
            .update(tickets)
            .set({ status: 'cancelled' })
            .where(and(eq(tickets.orderId, orderId), eq(tickets.status, 'pending')))
            .returning({ ticketTypeId: tickets.ticketTypeId });

          // Release the seats the pending order was holding — without this,
          // abandoned checkouts permanently eat capacity.
          const byType = new Map<string, number>();
          for (const t of cancelled) {
            if (t.ticketTypeId) byType.set(t.ticketTypeId, (byType.get(t.ticketTypeId) ?? 0) + 1);
          }
          for (const [ticketTypeId, count] of byType) {
            await tx
              .update(ticketTypes)
              .set({ soldCount: sql`GREATEST(${ticketTypes.soldCount} - ${count}, 0)` })
              .where(eq(ticketTypes.id, ticketTypeId));
          }
        });

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
