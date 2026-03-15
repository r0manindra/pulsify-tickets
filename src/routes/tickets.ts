import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
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
  quantity: z.number().int().positive().default(1),
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

  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return c.json({ error: 'Event not found' }, 404);

  const [tt] = await db
    .select()
    .from(ticketTypes)
    .where(and(eq(ticketTypes.id, parsed.data.ticketTypeId), eq(ticketTypes.eventId, eventId)))
    .limit(1);
  if (!tt) return c.json({ error: 'Ticket type not found' }, 404);

  if (tt.quantity !== null && (tt.soldCount ?? 0) + parsed.data.quantity > tt.quantity) {
    return c.json({ error: 'Not enough tickets available' }, 409);
  }

  const totalAmount = Number(tt.price) * parsed.data.quantity;
  const isPaid = totalAmount > 0;
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

  // Calculate platform fee based on org tier
  // Freemium: 10% + 1€/ticket, Basic: 8% + 1€/ticket, Premium: 5% + 1€/ticket
  const totalAmountCents = Math.round(totalAmount * 100);
  const platformFeeAmount = isPaid
    ? calculatePlatformFee(org?.tier ?? 'freemium', totalAmountCents, parsed.data.quantity)
    : 0;

  // Create order
  const [order] = await db
    .insert(orders)
    .values({
      eventId,
      userId,
      orderReference: orderRef,
      status: isPaid ? 'pending' : 'complete',
      totalAmount: String(totalAmount),
      platformFeeAmount: isPaid ? String(platformFeeAmount / 100) : null,
      currency: tt.currency,
    })
    .returning();

  // Create tickets
  const createdTickets = [];
  for (let i = 0; i < parsed.data.quantity; i++) {
    const ticketRef = generateTicketReference(orderRef, i);
    const qrData = crypto.randomUUID();

    const [ticket] = await db
      .insert(tickets)
      .values({
        orderId: order.id,
        eventId,
        ticketTypeId: tt.id,
        userId,
        ticketReference: ticketRef,
        qrData,
        name: parsed.data.name,
        email: parsed.data.email,
        status: isPaid ? 'pending' : 'active',
      })
      .returning();
    createdTickets.push(ticket);
  }

  // Update sold count
  await db
    .update(ticketTypes)
    .set({ soldCount: (tt.soldCount ?? 0) + parsed.data.quantity })
    .where(eq(ticketTypes.id, tt.id));

  // For paid tickets, create Stripe Checkout Session
  let checkoutUrl: string | null = null;
  if (isPaid && org?.stripeConnectedAccountId) {
    const session = await createCheckoutSession({
      connectedAccountId: org.stripeConnectedAccountId,
      lineItems: [
        {
          price_data: {
            currency: (tt.currency ?? 'EUR').toLowerCase(),
            product_data: {
              name: tt.name,
              description: `${event.title} - ${tt.name}`,
            },
            unit_amount: Math.round(Number(tt.price) * 100), // cents
          },
          quantity: parsed.data.quantity,
        },
      ],
      orderId: order.id,
      platformFeeAmount,
      currency: (tt.currency ?? 'EUR').toLowerCase(),
      successUrl: `${config.appUrl}/api/v1/orders/${order.id}/success`,
      cancelUrl: `${config.appUrl}/api/v1/orders/${order.id}/cancel`,
      customerEmail: parsed.data.email,
    });

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

  const [updated] = await db
    .update(tickets)
    .set({ status: 'voided' })
    .where(eq(tickets.id, id))
    .returning();

  return c.json({ ticket: updated });
});

export default app;
