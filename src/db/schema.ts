import { pgTable, uuid, text, timestamp, integer, decimal, boolean, jsonb } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  titoAccountSlug: text('tito_account_slug'),
  titoApiToken: text('tito_api_token'),
  stripeConnectedAccountId: text('stripe_account_id'),
  apiKey: text('api_key').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const events = pgTable('events', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id).notNull(),
  titoEventSlug: text('tito_event_slug'),
  title: text('title').notNull(),
  description: text('description'),
  location: text('location'),
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date'),
  currency: text('currency').default('EUR'),
  isLive: boolean('is_live').default(false),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const ticketTypes = pgTable('ticket_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id').references(() => events.id).notNull(),
  titoReleaseId: text('tito_release_id'),
  titoReleaseSlug: text('tito_release_slug'),
  name: text('name').notNull(),
  price: decimal('price', { precision: 10, scale: 2 }).default('0'),
  currency: text('currency').default('EUR'),
  quantity: integer('quantity'),
  soldCount: integer('sold_count').default(0),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id').references(() => events.id).notNull(),
  userId: text('user_id').notNull(),
  titoRegistrationId: text('tito_registration_id'),
  titoReference: text('tito_reference'),
  status: text('status').default('pending'),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }),
  currency: text('currency').default('EUR'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const tickets = pgTable('tickets', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => orders.id),
  eventId: uuid('event_id').references(() => events.id).notNull(),
  ticketTypeId: uuid('ticket_type_id').references(() => ticketTypes.id),
  userId: text('user_id').notNull(),
  titoTicketId: text('tito_ticket_id'),
  titoTicketSlug: text('tito_ticket_slug'),
  titoReference: text('tito_reference'),
  qrCodeUrl: text('qr_code_url'),
  name: text('name'),
  email: text('email'),
  status: text('status').default('active'),
  checkedInAt: timestamp('checked_in_at'),
  createdAt: timestamp('created_at').defaultNow(),
});
