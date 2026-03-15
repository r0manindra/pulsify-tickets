# Pulsify Ticket Service

Standalone ticketing microservice for the Pulsify platform. Handles event creation, ticket sales, QR code generation, and check-in — with **Stripe Connect** for automatic payment splitting between Pulsify and event organizers.

## How It Works

```
User buys ticket → Stripe splits payment → 90% to business, 10% to Pulsify
```

- **Free tickets**: Instant — no Stripe involved, just a database insert
- **Paid tickets**: Stripe Checkout → webhook confirms payment → tickets activated
- **Check-in**: Scanner reads QR code → local DB lookup → no external API calls

## Tech Stack

| | |
|---|---|
| **Runtime** | Node.js 20+ |
| **Framework** | [Hono](https://hono.dev) |
| **Database** | PostgreSQL |
| **ORM** | [Drizzle](https://orm.drizzle.team) |
| **Payments** | [Stripe Connect](https://stripe.com/connect) (Express accounts) |
| **QR Codes** | Generated locally via `qrcode` |
| **Auth** | JWT (end users) + API Key (server-to-server) |
| **Deployment** | Railway (Docker) |

## Tier-Based Platform Fees

| Tier | Fee |
|------|-----|
| Freemium | 10% + 1€ per ticket |
| Basic | 8% + 1€ per ticket |
| Premium | 5% + 1€ per ticket |

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Fill in your values (see .env.example)

# Push database schema
npm run db:push

# Start dev server
npm run dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `DATABASE_URL` | PostgreSQL connection string |
| `API_ADMIN_SECRET` | Secret for creating organizations |
| `APP_URL` | Public URL of this service |
| `STRIPE_SECRET_KEY` | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `JWT_SECRET` | Shared secret with Pulsify backend |

## API Overview

All endpoints under `/api/v1`. Auth via `Authorization: Bearer <token>`.

### Organizations (Admin / API Key)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/orgs` | Create org (admin) |
| `GET` | `/orgs/:id` | Get org details |
| `PATCH` | `/orgs/:id` | Update org name/tier (admin) |
| `POST` | `/orgs/:id/connect-stripe` | Start Stripe Connect onboarding |
| `GET` | `/orgs/:id/stripe-status` | Check Stripe onboarding status |

### Events (API Key / Public)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/events` | Create event with ticket types |
| `GET` | `/events` | List org's events |
| `GET` | `/events/:id` | Get event details (public) |
| `PATCH` | `/events/:id` | Update event |
| `DELETE` | `/events/:id` | Delete event |

### Ticket Types (API Key / Public)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/events/:id/ticket-types` | Create ticket type |
| `GET` | `/events/:id/ticket-types` | List ticket types (public) |
| `PATCH` | `/ticket-types/:id` | Update ticket type |
| `DELETE` | `/ticket-types/:id` | Delete ticket type |

### Tickets (JWT / API Key)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/events/:id/register` | Buy/register for tickets (JWT) |
| `GET` | `/me/tickets` | List user's tickets (JWT) |
| `GET` | `/tickets/:id` | Get single ticket (JWT) |
| `GET` | `/tickets/:id/qr` | Get QR code PNG (JWT) |
| `POST` | `/tickets/:id/void` | Void a ticket (API Key) |

### Check-in (API Key)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/events/:id/checkin` | Check in by ticket ID or QR data |
| `DELETE` | `/events/:id/checkin/:ticketId` | Undo check-in |
| `GET` | `/events/:id/attendees` | Attendee list with check-in stats |

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/stripe` | Receives Stripe webhook events |

## Key Flows

### Business Onboarding (one-time)
```
POST /orgs/:id/connect-stripe → returns Stripe onboarding URL
Business completes Stripe onboarding → webhook confirms → can sell paid tickets
```

### Free Ticket
```
POST /events/:id/register → order complete, ticket active immediately
GET /tickets/:id/qr → QR code PNG
```

### Paid Ticket
```
POST /events/:id/register → returns checkoutUrl
User pays on Stripe Checkout → webhook fires → tickets activated
GET /tickets/:id/qr → QR code PNG
```

### Check-in at Venue
```
Scanner reads QR → POST /events/:id/checkin { qrData } → ticket checked in
```

## Database Schema

5 tables: `organizations`, `events`, `ticket_types`, `orders`, `tickets`

See [DOKUMENTATION.md](./DOKUMENTATION.md) for full schema details, integration guide, and code examples for Dashboard (React) and Mobile App (React Native).

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run production build |
| `npm run db:push` | Push schema to database |
| `npm run db:generate` | Generate migration files |
| `npm run db:migrate` | Run migrations |

## Deployment

Uses a multi-stage Dockerfile. Deploy to Railway, Fly.io, or any Docker host.

```bash
# Build
npm run build

# Start
npm start
```

## License

Private — Pulsify GmbH
