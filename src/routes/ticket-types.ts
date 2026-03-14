import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { events, ticketTypes } from '../db/schema.js';
import { requireApiKey } from '../middleware/auth.js';

const app = new Hono();

const createTicketTypeSchema = z.object({
  name: z.string().min(1),
  price: z.string().or(z.number()).default('0'),
  currency: z.string().default('EUR'),
  quantity: z.number().int().positive().optional(),
});

const updateTicketTypeSchema = z.object({
  name: z.string().min(1).optional(),
  price: z.string().or(z.number()).optional(),
  quantity: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

// POST /events/:id/ticket-types
app.post('/events/:id/ticket-types', requireApiKey, async (c) => {
  const orgId = c.get('auth').organizationId!;
  const eventId = c.req.param('id')!;
  const body = await c.req.json();
  const parsed = createTicketTypeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, orgId)))
    .limit(1);
  if (!event) return c.json({ error: 'Event not found' }, 404);

  const [tt] = await db
    .insert(ticketTypes)
    .values({
      eventId,
      name: parsed.data.name,
      price: String(parsed.data.price),
      currency: parsed.data.currency,
      quantity: parsed.data.quantity,
    })
    .returning();

  return c.json({ ticketType: tt }, 201);
});

// GET /events/:id/ticket-types — public
app.get('/events/:id/ticket-types', async (c) => {
  const eventId = c.req.param('id')!;

  const types = await db
    .select({
      id: ticketTypes.id,
      name: ticketTypes.name,
      price: ticketTypes.price,
      currency: ticketTypes.currency,
      quantity: ticketTypes.quantity,
      soldCount: ticketTypes.soldCount,
      isActive: ticketTypes.isActive,
    })
    .from(ticketTypes)
    .where(eq(ticketTypes.eventId, eventId));

  return c.json({
    ticketTypes: types.map((t) => ({
      ...t,
      available: t.quantity !== null ? t.quantity - (t.soldCount ?? 0) : null,
    })),
  });
});

// PATCH /ticket-types/:id
app.patch('/ticket-types/:id', requireApiKey, async (c) => {
  const orgId = c.get('auth').organizationId!;
  const id = c.req.param('id')!;
  const body = await c.req.json();
  const parsed = updateTicketTypeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const [existing] = await db.select().from(ticketTypes).where(eq(ticketTypes.id, id)).limit(1);
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, existing.eventId), eq(events.organizationId, orgId)))
    .limit(1);
  if (!event) return c.json({ error: 'Forbidden' }, 403);

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name) updateData.name = parsed.data.name;
  if (parsed.data.price !== undefined) updateData.price = String(parsed.data.price);
  if (parsed.data.quantity !== undefined) updateData.quantity = parsed.data.quantity;
  if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;

  const [updated] = await db
    .update(ticketTypes)
    .set(updateData)
    .where(eq(ticketTypes.id, id))
    .returning();

  return c.json({ ticketType: updated });
});

// DELETE /ticket-types/:id
app.delete('/ticket-types/:id', requireApiKey, async (c) => {
  const orgId = c.get('auth').organizationId!;
  const id = c.req.param('id')!;

  const [existing] = await db.select().from(ticketTypes).where(eq(ticketTypes.id, id)).limit(1);
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, existing.eventId), eq(events.organizationId, orgId)))
    .limit(1);
  if (!event) return c.json({ error: 'Forbidden' }, 403);

  await db.delete(ticketTypes).where(eq(ticketTypes.id, id));
  return c.json({ success: true });
});

export default app;
