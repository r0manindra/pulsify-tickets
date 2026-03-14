import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';
import { requireAdmin, requireApiKey } from '../middleware/auth.js';

const app = new Hono();

const createOrgSchema = z.object({
  name: z.string().min(1),
});

const connectTitoSchema = z.object({
  titoAccountSlug: z.string().min(1),
  titoApiToken: z.string().min(1),
});

// POST /orgs — create org (admin only)
app.post('/', requireAdmin, async (c) => {
  const body = await c.req.json();
  const parsed = createOrgSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const apiKey = `pk_${crypto.randomBytes(24).toString('hex')}`;

  const [org] = await db
    .insert(organizations)
    .values({ name: parsed.data.name, apiKey })
    .returning();

  return c.json({ organization: org }, 201);
});

// GET /orgs/:id — get org details (API key)
app.get('/:id', requireApiKey, async (c) => {
  const orgId = c.get('auth').organizationId!;
  const id = c.req.param('id')!;

  if (orgId !== id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const [org] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      titoAccountSlug: organizations.titoAccountSlug,
      stripeConnectedAccountId: organizations.stripeConnectedAccountId,
      createdAt: organizations.createdAt,
    })
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);

  if (!org) return c.json({ error: 'Not found' }, 404);

  return c.json({ organization: org });
});

// POST /orgs/:id/connect-tito — store Tito credentials
app.post('/:id/connect-tito', requireApiKey, async (c) => {
  const orgId = c.get('auth').organizationId!;
  const id = c.req.param('id')!;

  if (orgId !== id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const body = await c.req.json();
  const parsed = connectTitoSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const [updated] = await db
    .update(organizations)
    .set({
      titoAccountSlug: parsed.data.titoAccountSlug,
      titoApiToken: parsed.data.titoApiToken,
    })
    .where(eq(organizations.id, id))
    .returning();

  return c.json({ organization: { id: updated.id, name: updated.name, titoAccountSlug: updated.titoAccountSlug } });
});

export default app;
