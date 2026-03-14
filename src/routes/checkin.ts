import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { events, tickets } from '../db/schema.js';
import { requireApiKey } from '../middleware/auth.js';

const app = new Hono();

const checkinSchema = z.object({
  ticketId: z.string().uuid().optional(),
  qrData: z.string().optional(),
}).refine((data) => data.ticketId || data.qrData, {
  message: 'Either ticketId or qrData is required',
});

// POST /events/:id/checkin — check in a ticket
app.post('/:id/checkin', requireApiKey, async (c) => {
  const orgId = c.get('auth').organizationId!;
  const eventId = c.req.param('id')!;
  const body = await c.req.json();
  const parsed = checkinSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, orgId)))
    .limit(1);
  if (!event) return c.json({ error: 'Event not found' }, 404);

  let ticket;
  if (parsed.data.ticketId) {
    [ticket] = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, parsed.data.ticketId), eq(tickets.eventId, eventId)))
      .limit(1);
  } else if (parsed.data.qrData) {
    [ticket] = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.qrData, parsed.data.qrData), eq(tickets.eventId, eventId)))
      .limit(1);
  }

  if (!ticket) return c.json({ error: 'Ticket not found' }, 404);

  if (ticket.status === 'checked_in') {
    return c.json({ error: 'Ticket already checked in', checkedInAt: ticket.checkedInAt }, 409);
  }

  if (ticket.status === 'voided' || ticket.status === 'cancelled') {
    return c.json({ error: `Ticket is ${ticket.status}` }, 400);
  }

  if (ticket.status !== 'active') {
    return c.json({ error: 'Ticket is not active' }, 400);
  }

  const now = new Date();
  const [updated] = await db
    .update(tickets)
    .set({ status: 'checked_in', checkedInAt: now })
    .where(eq(tickets.id, ticket.id))
    .returning();

  return c.json({
    ticket: updated,
    checkin: { checkedInAt: now },
  });
});

// DELETE /events/:id/checkin/:ticketId — undo check-in
app.delete('/:id/checkin/:ticketId', requireApiKey, async (c) => {
  const orgId = c.get('auth').organizationId!;
  const eventId = c.req.param('id')!;
  const ticketId = c.req.param('ticketId')!;

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, orgId)))
    .limit(1);
  if (!event) return c.json({ error: 'Event not found' }, 404);

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.eventId, eventId)))
    .limit(1);
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404);

  const [updated] = await db
    .update(tickets)
    .set({ status: 'active', checkedInAt: null })
    .where(eq(tickets.id, ticketId))
    .returning();

  return c.json({ ticket: updated });
});

// GET /events/:id/attendees — list attendees with check-in status
app.get('/:id/attendees', requireApiKey, async (c) => {
  const orgId = c.get('auth').organizationId!;
  const eventId = c.req.param('id')!;

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, orgId)))
    .limit(1);
  if (!event) return c.json({ error: 'Event not found' }, 404);

  const attendees = await db
    .select()
    .from(tickets)
    .where(eq(tickets.eventId, eventId));

  return c.json({
    attendees: attendees.map((t) => ({
      ticketId: t.id,
      name: t.name,
      email: t.email,
      status: t.status,
      checkedInAt: t.checkedInAt,
      ticketReference: t.ticketReference,
    })),
    summary: {
      total: attendees.length,
      checkedIn: attendees.filter((t) => t.status === 'checked_in').length,
      pending: attendees.filter((t) => t.status === 'active').length,
    },
  });
});

export default app;
