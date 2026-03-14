import { Hono } from 'hono';
import crypto from 'node:crypto';
import { config } from '../config.js';
import {
  handleRegistrationCompleted,
  handleTicketCompleted,
  handleTicketVoided,
  handleRegistrationCancelled,
  handleCheckin,
} from '../services/sync.js';

const app = new Hono();

function verifyTitoSignature(body: string, signature: string | undefined): boolean {
  if (!config.tito.webhookSecret) return true; // Skip verification if no secret configured
  if (!signature) return false;

  const expected = crypto
    .createHmac('sha256', config.tito.webhookSecret)
    .update(body)
    .digest('base64');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// POST /webhooks/tito — receive Tito webhook events
app.post('/tito', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('Tito-Signature');

  if (!verifyTitoSignature(rawBody, signature)) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  const payload = JSON.parse(rawBody) as Record<string, unknown>;
  const trigger = payload.trigger as string;

  console.log(`[Webhook] Received: ${trigger}`);

  try {
    switch (trigger) {
      case 'registration.finished':
      case 'registration.completed':
        await handleRegistrationCompleted(payload);
        break;
      case 'ticket.completed':
        await handleTicketCompleted(payload);
        break;
      case 'ticket.voided':
        await handleTicketVoided(payload);
        break;
      case 'registration.cancelled':
        await handleRegistrationCancelled(payload);
        break;
      case 'checkin.created':
        await handleCheckin(payload);
        break;
      default:
        console.log(`[Webhook] Unhandled trigger: ${trigger}`);
    }
  } catch (err) {
    console.error(`[Webhook] Error processing ${trigger}:`, err);
    // Return 200 anyway to prevent Tito from retrying
  }

  return c.json({ received: true });
});

export default app;
