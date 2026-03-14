import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { events, ticketTypes, orders, tickets } from '../db/schema.js';

export async function handleRegistrationCompleted(payload: Record<string, unknown>) {
  const registration = payload as Record<string, unknown>;
  const eventSlug = registration.event_slug as string | undefined;
  if (!eventSlug) return;

  // Find local event by Tito slug
  const [event] = await db
    .select()
    .from(events)
    .where(eq(events.titoEventSlug, eventSlug))
    .limit(1);
  if (!event) return;

  const titoRegId = String(registration.id);
  const reference = registration.reference as string;

  // Upsert order
  const [existingOrder] = await db
    .select()
    .from(orders)
    .where(eq(orders.titoRegistrationId, titoRegId))
    .limit(1);

  let orderId: string;
  if (existingOrder) {
    await db
      .update(orders)
      .set({ status: 'complete' })
      .where(eq(orders.id, existingOrder.id));
    orderId = existingOrder.id;
  } else {
    const [order] = await db
      .insert(orders)
      .values({
        eventId: event.id,
        userId: (registration.email as string) || 'unknown',
        titoRegistrationId: titoRegId,
        titoReference: reference,
        status: 'complete',
        totalAmount: String(registration.total || '0'),
        currency: (registration.currency as string) || 'EUR',
      })
      .returning();
    orderId = order.id;
  }

  // Sync tickets if present
  const regTickets = registration.tickets as Array<Record<string, unknown>> | undefined;
  if (regTickets) {
    for (const t of regTickets) {
      const titoTicketId = String(t.id);
      const [existingTicket] = await db
        .select()
        .from(tickets)
        .where(eq(tickets.titoTicketId, titoTicketId))
        .limit(1);

      // Find matching ticket type
      const releaseSlug = t.release_slug as string | undefined;
      let ticketTypeId: string | undefined;
      if (releaseSlug) {
        const [tt] = await db
          .select()
          .from(ticketTypes)
          .where(and(eq(ticketTypes.titoReleaseSlug, releaseSlug), eq(ticketTypes.eventId, event.id)))
          .limit(1);
        if (tt) ticketTypeId = tt.id;
      }

      if (!existingTicket) {
        await db.insert(tickets).values({
          orderId,
          eventId: event.id,
          ticketTypeId,
          userId: (t.email as string) || (registration.email as string) || 'unknown',
          titoTicketId,
          titoTicketSlug: t.slug as string,
          titoReference: t.reference as string,
          qrCodeUrl: t.slug ? `https://qr.tito.io/tickets/${t.slug}` : null,
          name: t.name as string,
          email: t.email as string,
          status: 'active',
        });
      }
    }
  }
}

export async function handleTicketCompleted(payload: Record<string, unknown>) {
  const titoTicketId = String(payload.id);
  const [existing] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.titoTicketId, titoTicketId))
    .limit(1);

  if (existing) {
    await db
      .update(tickets)
      .set({
        name: (payload.name as string) || existing.name,
        email: (payload.email as string) || existing.email,
        status: 'active',
      })
      .where(eq(tickets.id, existing.id));
  }
}

export async function handleTicketVoided(payload: Record<string, unknown>) {
  const titoTicketId = String(payload.id);
  await db
    .update(tickets)
    .set({ status: 'voided' })
    .where(eq(tickets.titoTicketId, titoTicketId));
}

export async function handleRegistrationCancelled(payload: Record<string, unknown>) {
  const titoRegId = String(payload.id);
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.titoRegistrationId, titoRegId))
    .limit(1);

  if (order) {
    await db
      .update(orders)
      .set({ status: 'cancelled' })
      .where(eq(orders.id, order.id));

    await db
      .update(tickets)
      .set({ status: 'cancelled' })
      .where(eq(tickets.orderId, order.id));
  }
}

export async function handleCheckin(payload: Record<string, unknown>) {
  const ticketId = payload.ticket_id ? String(payload.ticket_id) : null;
  if (!ticketId) return;

  await db
    .update(tickets)
    .set({ status: 'checked_in', checkedInAt: new Date() })
    .where(eq(tickets.titoTicketId, ticketId));
}
