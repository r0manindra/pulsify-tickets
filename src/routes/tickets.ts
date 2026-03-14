import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { events, ticketTypes, orders, tickets, organizations } from '../db/schema.js';
import { requireApiKey, requireJwt } from '../middleware/auth.js';
import { TitoClient } from '../services/tito.js';

const app = new Hono();

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  ticketTypeId: z.string().uuid(),
  quantity: z.number().int().positive().default(1),
});

async function getTitoClient(organizationId: string) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org?.titoAccountSlug || !org?.titoApiToken) return null;
  return new TitoClient(org.titoApiToken, org.titoAccountSlug);
}

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

  let titoRegistrationId: string | null = null;
  let titoReference: string | null = null;
  let checkoutUrl: string | null = null;
  const titoTickets: Array<{ id: string; slug: string; reference: string }> = [];

  const tito = await getTitoClient(event.organizationId);
  if (tito && event.titoEventSlug && tt.titoReleaseSlug) {
    const resp = await tito.createRegistration(event.titoEventSlug, {
      name: parsed.data.name,
      email: parsed.data.email,
      line_items: [{ release_id: tt.titoReleaseId, quantity: parsed.data.quantity }],
    });

    const reg = resp.registration as Record<string, unknown>;
    titoRegistrationId = String(reg.id);
    titoReference = reg.reference as string;

    if (reg.receipt && typeof reg.receipt === 'object' && 'url' in (reg.receipt as Record<string, unknown>)) {
      checkoutUrl = (reg.receipt as Record<string, unknown>).url as string;
    }

    if (Array.isArray(reg.tickets)) {
      for (const t of reg.tickets as Array<Record<string, unknown>>) {
        titoTickets.push({
          id: String(t.id),
          slug: t.slug as string,
          reference: t.reference as string,
        });
      }
    }
  }

  const [order] = await db
    .insert(orders)
    .values({
      eventId,
      userId,
      titoRegistrationId,
      titoReference,
      status: Number(tt.price) > 0 && checkoutUrl ? 'pending' : 'complete',
      totalAmount: String(Number(tt.price) * parsed.data.quantity),
      currency: tt.currency,
    })
    .returning();

  const createdTickets = [];
  if (titoTickets.length > 0) {
    for (const t of titoTickets) {
      const [ticket] = await db
        .insert(tickets)
        .values({
          orderId: order.id,
          eventId,
          ticketTypeId: tt.id,
          userId,
          titoTicketId: t.id,
          titoTicketSlug: t.slug,
          titoReference: t.reference,
          qrCodeUrl: `https://qr.tito.io/tickets/${t.slug}`,
          name: parsed.data.name,
          email: parsed.data.email,
          status: 'active',
        })
        .returning();
      createdTickets.push(ticket);
    }
  } else {
    for (let i = 0; i < parsed.data.quantity; i++) {
      const [ticket] = await db
        .insert(tickets)
        .values({
          orderId: order.id,
          eventId,
          ticketTypeId: tt.id,
          userId,
          name: parsed.data.name,
          email: parsed.data.email,
          status: 'active',
        })
        .returning();
      createdTickets.push(ticket);
    }
  }

  await db
    .update(ticketTypes)
    .set({ soldCount: (tt.soldCount ?? 0) + parsed.data.quantity })
    .where(eq(ticketTypes.id, tt.id));

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

// GET /tickets/:id — single ticket with QR
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

// GET /tickets/:id/qr — proxy QR code image from Tito
app.get('/tickets/:id/qr', requireJwt, async (c) => {
  const userId = c.get('auth').userId!;
  const id = c.req.param('id')!;

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, id), eq(tickets.userId, userId)))
    .limit(1);

  if (!ticket) return c.json({ error: 'Not found' }, 404);
  if (!ticket.qrCodeUrl) return c.json({ error: 'No QR code available' }, 404);

  const resp = await fetch(ticket.qrCodeUrl);
  if (!resp.ok) return c.json({ error: 'Failed to fetch QR code' }, 502);

  c.header('Content-Type', resp.headers.get('Content-Type') || 'image/png');
  c.header('Cache-Control', 'public, max-age=3600');
  return c.body(resp.body as ReadableStream);
});

// POST /tickets/:id/void — void a ticket (API key)
app.post('/tickets/:id/void', requireApiKey, async (c) => {
  const id = c.req.param('id')!;

  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!ticket) return c.json({ error: 'Not found' }, 404);

  if (ticket.titoTicketSlug) {
    const [event] = await db
      .select()
      .from(events)
      .where(eq(events.id, ticket.eventId))
      .limit(1);

    if (event?.titoEventSlug) {
      const tito = await getTitoClient(event.organizationId);
      if (tito) {
        try {
          await tito.voidTicket(event.titoEventSlug, ticket.titoTicketSlug);
        } catch {
          // Non-fatal
        }
      }
    }
  }

  const [updated] = await db
    .update(tickets)
    .set({ status: 'voided' })
    .where(eq(tickets.id, id))
    .returning();

  return c.json({ ticket: updated });
});

export default app;
