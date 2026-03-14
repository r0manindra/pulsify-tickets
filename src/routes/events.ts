import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { events, ticketTypes, organizations } from '../db/schema.js';
import { requireApiKey } from '../middleware/auth.js';
import { TitoClient } from '../services/tito.js';

const app = new Hono();

const createEventSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  currency: z.string().default('EUR'),
  metadata: z.record(z.unknown()).optional(),
  ticketTypes: z
    .array(
      z.object({
        name: z.string().min(1),
        price: z.string().or(z.number()).default('0'),
        quantity: z.number().int().positive().optional(),
      }),
    )
    .optional(),
});

const updateEventSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  currency: z.string().optional(),
  isLive: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

async function getTitoClient(organizationId: string) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  if (!org?.titoAccountSlug || !org?.titoApiToken) {
    return null;
  }

  return new TitoClient(org.titoApiToken, org.titoAccountSlug);
}

// POST /events — create event
app.post('/', requireApiKey, async (c) => {
  const orgId = c.get('auth').organizationId!;
  const body = await c.req.json();
  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { ticketTypes: ttData, ...eventData } = parsed.data;
  let titoEventSlug: string | null = null;

  const tito = await getTitoClient(orgId);
  if (tito) {
    const titoResp = await tito.createEvent({
      title: eventData.title,
      description: eventData.description,
      location: eventData.location,
      start_date: eventData.startDate,
      end_date: eventData.endDate,
      currency: eventData.currency,
    });
    titoEventSlug = (titoResp.event as Record<string, unknown>).slug as string;
  }

  const [event] = await db
    .insert(events)
    .values({
      organizationId: orgId,
      titoEventSlug,
      title: eventData.title,
      description: eventData.description,
      location: eventData.location,
      startDate: new Date(eventData.startDate),
      endDate: eventData.endDate ? new Date(eventData.endDate) : null,
      currency: eventData.currency,
      metadata: eventData.metadata,
    })
    .returning();

  const createdTypes = [];
  if (ttData && ttData.length > 0) {
    for (const tt of ttData) {
      let titoReleaseId: string | null = null;
      let titoReleaseSlug: string | null = null;

      if (tito && titoEventSlug) {
        const releaseResp = await tito.createRelease(titoEventSlug, {
          title: tt.name,
          price: String(tt.price),
          quantity: tt.quantity,
        });
        const release = releaseResp.release as Record<string, unknown>;
        titoReleaseId = String(release.id);
        titoReleaseSlug = release.slug as string;
      }

      const [ticketType] = await db
        .insert(ticketTypes)
        .values({
          eventId: event.id,
          titoReleaseId,
          titoReleaseSlug,
          name: tt.name,
          price: String(tt.price),
          currency: eventData.currency,
          quantity: tt.quantity,
        })
        .returning();

      createdTypes.push(ticketType);
    }
  }

  return c.json({ event: { ...event, ticketTypes: createdTypes } }, 201);
});

// GET /events — list org's events
app.get('/', requireApiKey, async (c) => {
  const orgId = c.get('auth').organizationId!;

  const eventList = await db
    .select()
    .from(events)
    .where(eq(events.organizationId, orgId));

  return c.json({ events: eventList });
});

// GET /events/:id — get event with ticket types (public-ish)
app.get('/:id', async (c) => {
  const id = c.req.param('id')!;

  const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!event) return c.json({ error: 'Not found' }, 404);

  const types = await db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.eventId, id));

  return c.json({ event: { ...event, ticketTypes: types } });
});

// PATCH /events/:id — update event
app.patch('/:id', requireApiKey, async (c) => {
  const orgId = c.get('auth').organizationId!;
  const id = c.req.param('id')!;
  const body = await c.req.json();
  const parsed = updateEventSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const [existing] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), eq(events.organizationId, orgId)))
    .limit(1);

  if (!existing) return c.json({ error: 'Not found' }, 404);

  const tito = await getTitoClient(orgId);
  if (tito && existing.titoEventSlug) {
    const titoData: Record<string, unknown> = {};
    if (parsed.data.title) titoData.title = parsed.data.title;
    if (parsed.data.description !== undefined) titoData.description = parsed.data.description;
    if (parsed.data.location !== undefined) titoData.location = parsed.data.location;
    if (parsed.data.startDate) titoData.start_date = parsed.data.startDate;
    if (parsed.data.endDate) titoData.end_date = parsed.data.endDate;
    if (parsed.data.isLive !== undefined) titoData.live = parsed.data.isLive;
    if (Object.keys(titoData).length > 0) {
      await tito.updateEvent(existing.titoEventSlug, titoData);
    }
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.title) updateData.title = parsed.data.title;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.location !== undefined) updateData.location = parsed.data.location;
  if (parsed.data.startDate) updateData.startDate = new Date(parsed.data.startDate);
  if (parsed.data.endDate) updateData.endDate = new Date(parsed.data.endDate);
  if (parsed.data.currency) updateData.currency = parsed.data.currency;
  if (parsed.data.isLive !== undefined) updateData.isLive = parsed.data.isLive;
  if (parsed.data.metadata) updateData.metadata = parsed.data.metadata;

  const [updated] = await db
    .update(events)
    .set(updateData)
    .where(eq(events.id, id))
    .returning();

  return c.json({ event: updated });
});

// DELETE /events/:id
app.delete('/:id', requireApiKey, async (c) => {
  const orgId = c.get('auth').organizationId!;
  const id = c.req.param('id')!;

  const [existing] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), eq(events.organizationId, orgId)))
    .limit(1);

  if (!existing) return c.json({ error: 'Not found' }, 404);

  const tito = await getTitoClient(orgId);
  if (tito && existing.titoEventSlug) {
    try {
      await tito.deleteEvent(existing.titoEventSlug);
    } catch {
      // Non-fatal
    }
  }

  await db.delete(ticketTypes).where(eq(ticketTypes.eventId, id));
  await db.delete(events).where(eq(events.id, id));

  return c.json({ success: true });
});

export default app;
