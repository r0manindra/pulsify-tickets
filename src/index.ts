import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { config } from './config.js';
import { errorHandler } from './middleware/error-handler.js';
import organizationsRouter from './routes/organizations.js';
import eventsRouter from './routes/events.js';
import ticketTypesRouter from './routes/ticket-types.js';
import ticketsRouter from './routes/tickets.js';
import checkinRouter from './routes/checkin.js';
import webhooksRouter from './routes/webhooks.js';

const app = new Hono();

// Global middleware
app.use('*', logger());
app.use('*', cors());

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// API routes
const api = new Hono();

api.route('/orgs', organizationsRouter);
api.route('/events', eventsRouter);
api.route('/events', ticketTypesRouter);  // /events/:id/ticket-types
api.route('/events', checkinRouter);      // /events/:id/checkin, /events/:id/attendees
api.route('/', ticketsRouter);            // /me/tickets, /tickets/:id, /events/:id/register
api.route('/webhooks', webhooksRouter);

// Ticket type management routes at top level
api.route('/', ticketTypesRouter);        // /ticket-types/:id (PATCH, DELETE)

app.route('/api/v1', api);

// Error handler
app.onError(errorHandler);

// 404
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Start server
const port = config.port;
console.log(`Starting Pulsify Ticket Service on port ${port}`);
serve({ fetch: app.fetch, port });
