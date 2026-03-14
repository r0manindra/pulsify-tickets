import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';
import { requireAdmin, requireApiKey } from '../middleware/auth.js';
import { createConnectedAccount, createOnboardingLink, getAccountStatus } from '../services/stripe.js';

const app = new Hono();

const createOrgSchema = z.object({
  name: z.string().min(1),
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
      stripeConnectedAccountId: organizations.stripeConnectedAccountId,
      stripeOnboardingComplete: organizations.stripeOnboardingComplete,
      createdAt: organizations.createdAt,
    })
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);

  if (!org) return c.json({ error: 'Not found' }, 404);

  return c.json({ organization: org });
});

// POST /orgs/:id/connect-stripe — start Stripe Connect onboarding
app.post('/:id/connect-stripe', requireApiKey, async (c) => {
  const orgId = c.get('auth').organizationId!;
  const id = c.req.param('id')!;

  if (orgId !== id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);

  if (!org) return c.json({ error: 'Not found' }, 404);

  // If already has a Stripe account, just generate a new onboarding link
  let accountId = org.stripeConnectedAccountId;

  if (!accountId) {
    const account = await createConnectedAccount(org.name);
    accountId = account.id;

    await db
      .update(organizations)
      .set({ stripeConnectedAccountId: accountId })
      .where(eq(organizations.id, id));
  }

  const link = await createOnboardingLink(accountId, id);

  return c.json({ onboardingUrl: link.url });
});

// GET /orgs/:id/stripe-status — check Stripe onboarding status
app.get('/:id/stripe-status', requireApiKey, async (c) => {
  const orgId = c.get('auth').organizationId!;
  const id = c.req.param('id')!;

  if (orgId !== id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);

  if (!org) return c.json({ error: 'Not found' }, 404);

  if (!org.stripeConnectedAccountId) {
    return c.json({ status: 'not_started', chargesEnabled: false, payoutsEnabled: false });
  }

  const accountStatus = await getAccountStatus(org.stripeConnectedAccountId);

  // Update onboarding status if charges are now enabled
  if (accountStatus.chargesEnabled && !org.stripeOnboardingComplete) {
    await db
      .update(organizations)
      .set({ stripeOnboardingComplete: true })
      .where(eq(organizations.id, id));
  }

  return c.json({
    status: accountStatus.chargesEnabled ? 'complete' : 'pending',
    ...accountStatus,
  });
});

export default app;
