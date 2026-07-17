import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'node:crypto';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { events, ticketTypes, orders, tickets, organizations } from '../db/schema.js';
import { requireApiKey, requireJwt } from '../middleware/auth.js';
import { createCheckoutSession } from '../services/stripe.js';
import { generateQrPng } from '../services/qr.js';
import { generateOrderReference, generateTicketReference } from '../services/references.js';
import { calculatePlatformFee } from '../services/fees.js';
import { config } from '../config.js';

const app = new Hono();

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  ticketTypeId: z.string().uuid(),
  quantity: z.number().int().positive().max(10).default(1),
});

// POST /events/:id/register — register/purchase tickets (JWT)
app.post('/events/:id/register', requireJwt, async (c) => {
  const userId = c.get('auth').userId!;
  const eventId = c.req.param('id')!;
  const body = await c.req.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }
  const quantity = parsed.data.quantity;

  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return c.json({ error: 'Event not found' }, 404);

  // Price/fee math stays in integer cents end to end; the decimal columns only
  // ever receive a cents-derived string, so float artifacts can't reach Stripe.
  const [preview] = await db
    .select()
    .from(ticketTypes)
    .where(and(eq(ticketTypes.id, parsed.data.ticketTypeId), eq(ticketTypes.eventId, eventId)))
    .limit(1);
  if (!preview) return c.json({ error: 'Ticket type not found' }, 404);
  if (preview.isActive === false) return c.json({ error: 'Ticket type is not on sale' }, 409);

  const unitPriceCents = Math.round(Number(preview.price) * 100);
  const totalCents = unitPriceCents * quantity;
  const isPaid = totalCents > 0;
  const orderRef = generateOrderReference();

  // For paid tickets, check org has Stripe connected
  let org = null;
  if (isPaid) {
    [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, event.organizationId))
      .limit(1);

    if (!org?.stripeConnectedAccountId || !org?.stripeOnboardingComplete) {
      return c.json({ error: 'Organization has not completed payment setup' }, 400);
    }
  }

  // Freemium: 10% + 1€/ticket, Basic: 8% + 1€/ticket, Premium: 5% + 1€/ticket
  const platformFeeAmount = isPaid
    ? calculatePlatformFee(org?.tier ?? 'freemium', totalCents, quantity)
    : 0;

  // Reserve seats atomically: the FOR UPDATE lock serializes concurrent buyers on
  // the ticket-type row, so check-capacity + insert + sold_count move as one unit
  // and two simultaneous purchases can no longer oversell the last seats.
  let reservation;
  try {
    reservation = await db.transaction(async (tx) => {
      const [tt] = await tx
        .select()
        .from(ticketTypes)
        .where(and(eq(ticketTypes.id, parsed.data.ticketTypeId), eq(ticketTypes.eventId, eventId)))
        .limit(1)
        .for('update');
      if (!tt || tt.isActive === false) return null;

      if (tt.quantity !== null && (tt.soldCount ?? 0) + quantity > tt.quantity) {
        return { soldOut: true as const };
      }

      const [order] = await tx
        .insert(orders)
        .values({
          eventId,
          userId,
          orderReference: orderRef,
          status: isPaid ? 'pending' : 'complete',
          totalAmount: (totalCents / 100).toFixed(2),
          platformFeeAmount: isPaid ? (platformFeeAmount / 100).toFixed(2) : null,
          currency: tt.currency,
        })
        .returning();

      const createdTickets = [];
      for (let i = 0; i < quantity; i++) {
        const [ticket] = await tx
          .insert(tickets)
          .values({
            orderId: order.id,
            eventId,
            ticketTypeId: tt.id,
            userId,
            ticketReference: generateTicketReference(orderRef, i),
            qrData: crypto.randomUUID(),
            name: parsed.data.name,
            email: parsed.data.email,
            status: isPaid ? 'pending' : 'active',
          })
          .returning();
        createdTickets.push(ticket);
      }

      await tx
        .update(ticketTypes)
        .set({ soldCount: sql`${ticketTypes.soldCount} + ${quantity}` })
        .where(eq(ticketTypes.id, tt.id));

      return { soldOut: false as const, order, createdTickets, ticketType: tt };
    });
  } catch {
    return c.json({ error: 'Could not reserve tickets, please retry' }, 500);
  }

  if (!reservation) return c.json({ error: 'Ticket type not found' }, 404);
  if (reservation.soldOut) return c.json({ error: 'Not enough tickets available' }, 409);
  const { order, createdTickets, ticketType: tt } = reservation;

  // For paid tickets, create Stripe Checkout Session
  let checkoutUrl: string | null = null;
  if (isPaid && org?.stripeConnectedAccountId) {
    let session;
    try {
      session = await createCheckoutSession({
        connectedAccountId: org.stripeConnectedAccountId,
        lineItems: [
          {
            price_data: {
              currency: (tt.currency ?? 'EUR').toLowerCase(),
              product_data: {
                name: tt.name,
                description: `${event.title} - ${tt.name}`,
              },
              unit_amount: unitPriceCents,
            },
            quantity,
          },
        ],
        orderId: order.id,
        platformFeeAmount,
        currency: (tt.currency ?? 'EUR').toLowerCase(),
        successUrl: `${config.appUrl}/api/v1/orders/${order.id}/success`,
        cancelUrl: `${config.appUrl}/api/v1/orders/${order.id}/cancel`,
        customerEmail: parsed.data.email,
      });
    } catch {
      // Stripe refused/failed: release the reservation instead of stranding a
      // pending order that holds seats forever with no checkout to complete it.
      await db.transaction(async (tx) => {
        await tx.update(orders).set({ status: 'cancelled' }).where(eq(orders.id, order.id));
        await tx
          .update(tickets)
          .set({ status: 'cancelled' })
          .where(eq(tickets.orderId, order.id));
        await tx
          .update(ticketTypes)
          .set({ soldCount: sql`GREATEST(${ticketTypes.soldCount} - ${quantity}, 0)` })
          .where(eq(ticketTypes.id, tt.id));
      });
      return c.json({ error: 'Payment provider unavailable, please retry' }, 502);
    }

    checkoutUrl = session.url;

    // Store checkout session ID on the order
    await db
      .update(orders)
      .set({ stripeCheckoutSessionId: session.id })
      .where(eq(orders.id, order.id));
  }

  return c.json({
    order,
    tickets: createdTickets,
    ...(checkoutUrl ? { checkoutUrl } : {}),
  }, 201);
});

// GET /me/tickets — list user's tickets
app.get('/me/tickets', requireJwt, async (c) => {
  const userId = c.get('auth').userId!;

  const userTickets = await db
    .select({
      ticket: tickets,
      eventTitle: events.title,
      eventLocation: events.location,
      eventStartDate: events.startDate,
      ticketTypeName: ticketTypes.name,
    })
    .from(tickets)
    .leftJoin(events, eq(tickets.eventId, events.id))
    .leftJoin(ticketTypes, eq(tickets.ticketTypeId, ticketTypes.id))
    .where(eq(tickets.userId, userId));

  return c.json({
    tickets: userTickets.map((row) => ({
      ...row.ticket,
      event: {
        title: row.eventTitle,
        location: row.eventLocation,
        startDate: row.eventStartDate,
      },
      ticketType: row.ticketTypeName,
    })),
  });
});

// GET /tickets/:id — single ticket
app.get('/tickets/:id', requireJwt, async (c) => {
  const userId = c.get('auth').userId!;
  const id = c.req.param('id')!;

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, id), eq(tickets.userId, userId)))
    .limit(1);

  if (!ticket) return c.json({ error: 'Not found' }, 404);
  return c.json({ ticket });
});

// GET /tickets/:id/qr — generate QR code PNG
app.get('/tickets/:id/qr', requireJwt, async (c) => {
  const userId = c.get('auth').userId!;
  const id = c.req.param('id')!;

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, id), eq(tickets.userId, userId)))
    .limit(1);

  if (!ticket) return c.json({ error: 'Not found' }, 404);
  if (!ticket.qrData) return c.json({ error: 'No QR code available' }, 404);
  if (ticket.status !== 'active' && ticket.status !== 'checked_in') {
    return c.json({ error: 'Ticket is not active' }, 400);
  }

  const qrBuffer = await generateQrPng(ticket.qrData);

  return new Response(new Uint8Array(qrBuffer), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

// POST /tickets/:id/void — void a ticket (API key)
app.post('/tickets/:id/void', requireApiKey, async (c) => {
  const id = c.req.param('id')!;

  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!ticket) return c.json({ error: 'Not found' }, 404);

  const updated = await db.transaction(async (tx) => {
    // Guarded transition: only a still-counted ticket releases its seat, so a
    // double-void (or voiding an already-cancelled ticket) can't decrement twice.
    const [row] = await tx
      .update(tickets)
      .set({ status: 'voided' })
      .where(and(eq(tickets.id, id), inArray(tickets.status, ['pending', 'active'])))
      .returning();
    if (row?.ticketTypeId) {
      await tx
        .update(ticketTypes)
        .set({ soldCount: sql`GREATEST(${ticketTypes.soldCount} - 1, 0)` })
        .where(eq(ticketTypes.id, row.ticketTypeId));
    }
    if (!row) {
      const [asIs] = await tx
        .update(tickets)
        .set({ status: 'voided' })
        .where(eq(tickets.id, id))
        .returning();
      return asIs;
    }
    return row;
  });

  return c.json({ ticket: updated });
});

export default app;
