import { pgTable, uuid, text, timestamp, integer, decimal, boolean, jsonb } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  tier: text('tier').default('freemium'),
  stripeConnectedAccountId: text('stripe_account_id'),
  stripeOnboardingComplete: boolean('stripe_onboarding_complete').default(false),
  apiKey: text('api_key').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const events = pgTable('events', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id).notNull(),
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
  orderReference: text('order_reference').unique(),
  stripeCheckoutSessionId: text('stripe_checkout_session_id'),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  platformFeeAmount: decimal('platform_fee_amount', { precision: 10, scale: 2 }),
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
  ticketReference: text('ticket_reference').unique(),
  qrData: text('qr_data').unique(),
  name: text('name'),
  email: text('email'),
  status: text('status').default('active'),
  checkedInAt: timestamp('checked_in_at'),
  createdAt: timestamp('created_at').defaultNow(),
});
