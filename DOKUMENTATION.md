# Pulsify Ticket Service — Dokumentation

## Was ist das?

Der **Pulsify Ticket Service** ist ein eigenstaendiger Microservice fuer Ticketing auf der Pulsify-Plattform. Er nutzt **Stripe Connect** um Zahlungen zwischen Pulsify und den Veranstaltern (Businesses) automatisch aufzuteilen.

**Warum Stripe Connect?**
- Pulsify ist eine **Marketplace-Plattform** — mehrere Businesses verkaufen Tickets ueber Pulsify
- Stripe Connect erlaubt automatische Zahlungsaufteilung: z.B. 90% an den Veranstalter, 10% an Pulsify
- `application_fee_amount` teilt jede Zahlung automatisch auf — kein manuelles Auszahlen noetig
- Industriestandard fuer Marktplaetze (Uber, Eventbrite, DoorDash nutzen alle Stripe Connect)

**Warum nicht mehr Tito?**
- Tito hat keine Moeglichkeit fuer Plattform-Gebuehren (kein `application_fee_amount`)
- Tito ist Single-Tenant — alle Events laufen unter einem Account, keine Multi-Tenant Auszahlungen
- Kein White-Label — Checkout leitet auf Titos Seite weiter
- Tito ist gebaut fuer einzelne Veranstalter, nicht fuer Marktplaetze

**Mit Stripe Connect:**
```
Nutzer zahlt → Stripe teilt Zahlung → 90% an Business-Stripe-Konto, 10% an Pulsify. Automatisch.
```

---

## Architektur

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  Pulsify App        │     │  Pulsify Ticket       │     │  Stripe Connect │
│  (React Native)     │────>│  Service (Hono)       │────>│  (Payments)     │
│  + Dashboard        │     │  Railway              │     │                 │
└─────────────────────┘     └──────────────────────┘     └─────────────────┘
                                  │         ▲
                                  │         │
                                  ▼         │
                            ┌──────────┐  Webhooks
                            │ Postgres │  von Stripe
                            │ (Railway)│
                            └──────────┘
```

**Der Service macht 3 Dinge:**
1. **Verwaltet** Events und Tickets direkt in der eigenen Postgres (keine externe Sync noetig)
2. **Erstellt Stripe Checkout Sessions** fuer bezahlte Tickets mit automatischer Gebuehrenaufteilung
3. **Empfaengt Stripe Webhooks** um Zahlungsbestaetigung und Ticket-Aktivierung zu handhaben

---

## Tech Stack

| Komponente | Technologie |
|------------|-------------|
| Runtime | Node.js 20+ |
| Framework | Hono (leichtgewichtig, schnell) |
| Datenbank | PostgreSQL (Railway) |
| ORM | Drizzle (type-safe, SQL-nah) |
| Auth | API Key (Server-to-Server), JWT (Endnutzer) |
| Zahlungen | Stripe Connect (Express Accounts) |
| QR-Codes | Lokal generiert (`qrcode` npm Paket) |
| Deployment | Railway (Dockerfile) |

---

## Projektstruktur

```
pulsify-tickets/
├── src/
│   ├── index.ts                 # Hono App Entry Point
│   ├── config.ts                # Umgebungsvariablen
│   ├── middleware/
│   │   ├── auth.ts              # API Key + JWT Verifizierung
│   │   └── error-handler.ts     # Globales Error Handling
│   ├── routes/
│   │   ├── events.ts            # Event CRUD (rein lokal)
│   │   ├── tickets.ts           # Ticket-Kauf/Listing + Stripe Checkout
│   │   ├── ticket-types.ts      # Ticketarten (rein lokal)
│   │   ├── checkin.ts           # QR-Scan + Check-in (rein lokal)
│   │   ├── organizations.ts     # Org-Verwaltung + Stripe Connect Onboarding
│   │   └── webhooks.ts          # Stripe Webhook-Empfaenger
│   ├── services/
│   │   ├── stripe.ts            # Stripe SDK Wrapper (Connect, Checkout, Refunds)
│   │   ├── qr.ts                # QR-Code Generierung (PNG)
│   │   └── references.ts        # Bestell-/Ticket-Referenzcodes
│   ├── db/
│   │   ├── schema.ts            # Drizzle Schema (5 Tabellen)
│   │   ├── index.ts             # DB-Verbindung
│   │   └── migrations/          # Drizzle Migrationen
│   └── types/
│       └── index.ts             # TypeScript Types
├── drizzle.config.ts
├── Dockerfile
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Datenbank-Schema

### Tabelle: `organizations`
| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| id | UUID (PK) | Automatisch generiert |
| name | TEXT | Organisationsname |
| stripe_account_id | TEXT | Stripe Connected Account ID |
| stripe_onboarding_complete | BOOLEAN | Stripe Onboarding abgeschlossen? |
| api_key | TEXT (unique) | API Key fuer diese Organisation |
| created_at | TIMESTAMP | Erstellungsdatum |

### Tabelle: `events`
| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| id | UUID (PK) | Automatisch generiert |
| organization_id | UUID (FK) | Referenz auf organizations |
| title | TEXT | Event-Titel |
| description | TEXT | Beschreibung |
| location | TEXT | Veranstaltungsort |
| start_date | TIMESTAMP | Startdatum |
| end_date | TIMESTAMP | Enddatum |
| currency | TEXT | Waehrung (Standard: EUR) |
| is_live | BOOLEAN | Event veroeffentlicht? |
| metadata | JSONB | Pulsify-spezifische Daten |

### Tabelle: `ticket_types`
| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| id | UUID (PK) | Automatisch generiert |
| event_id | UUID (FK) | Referenz auf events |
| name | TEXT | z.B. "Early Bird", "VIP", "Free" |
| price | DECIMAL | Preis (0 = kostenlos) |
| currency | TEXT | Waehrung |
| quantity | INTEGER | Verfuegbare Anzahl |
| sold_count | INTEGER | Bereits verkauft |
| is_active | BOOLEAN | Aktiv/Inaktiv |

### Tabelle: `orders`
| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| id | UUID (PK) | Automatisch generiert |
| event_id | UUID (FK) | Referenz auf events |
| user_id | TEXT | Pulsify User ID |
| order_reference | TEXT (unique) | Lesbarer Referenzcode (z.B. "PUL-A3F8E2") |
| stripe_checkout_session_id | TEXT | Stripe Checkout Session ID |
| stripe_payment_intent_id | TEXT | Stripe Payment Intent ID |
| platform_fee_amount | DECIMAL | Pulsify Plattform-Gebuehr |
| status | TEXT | pending, complete, cancelled, refunded |
| total_amount | DECIMAL | Gesamtbetrag |
| currency | TEXT | Waehrung |

### Tabelle: `tickets`
| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| id | UUID (PK) | Automatisch generiert |
| order_id | UUID (FK) | Referenz auf orders |
| event_id | UUID (FK) | Referenz auf events |
| ticket_type_id | UUID (FK) | Referenz auf ticket_types |
| user_id | TEXT | Pulsify User ID |
| ticket_reference | TEXT (unique) | Lesbarer Code (z.B. "PUL-A3F8E2-1") |
| qr_data | TEXT (unique) | UUID fuer QR-Code (wird gescannt beim Check-in) |
| name | TEXT | Name des Ticketinhabers |
| email | TEXT | E-Mail des Ticketinhabers |
| status | TEXT | pending, active, checked_in, voided, cancelled |
| checked_in_at | TIMESTAMP | Check-in Zeitpunkt |

---

## API Endpoints

Alle Endpoints unter `/api/v1`. Authentifizierung ueber `Authorization: Bearer <token>`.

### Authentifizierung

| Aufrufer | Methode | Details |
|----------|---------|---------|
| Dashboard / Backend | API Key | Jede Org bekommt einen einzigartigen API Key (`pk_...`). Wird als Bearer Token gesendet. |
| Endnutzer (App) | JWT | Pulsifys bestehendes Auth-System stellt JWTs aus. Der Service verifiziert sie mit einem geteilten Secret. |
| Stripe Webhooks | Signatur | Verifizierung des `stripe-signature` Headers mit Webhook Secret. |
| Admin (Org erstellen) | Admin Secret | Spezieller Secret fuer das Erstellen neuer Organisationen. |

### Organisation / Setup

| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|-------------|
| POST | `/orgs` | Admin Secret | Neue Organisation registrieren, API Key generieren |
| GET | `/orgs/:id` | API Key | Org-Details abrufen (inkl. Stripe-Status) |
| POST | `/orgs/:id/connect-stripe` | API Key | Stripe Connect Onboarding starten, gibt Onboarding-URL zurueck |
| GET | `/orgs/:id/stripe-status` | API Key | Stripe Connect Status pruefen |

### Events

| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|-------------|
| POST | `/events` | API Key | Event erstellen (mit optionalen Ticketarten) |
| GET | `/events` | API Key | Alle Events der Organisation auflisten |
| GET | `/events/:id` | Oeffentlich | Event-Details + Ticketarten abrufen |
| PATCH | `/events/:id` | API Key | Event aktualisieren |
| DELETE | `/events/:id` | API Key | Event loeschen |

### Ticketarten

| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|-------------|
| POST | `/events/:id/ticket-types` | API Key | Ticketart erstellen |
| GET | `/events/:id/ticket-types` | Oeffentlich | Verfuegbare Ticketarten + Verfuegbarkeit |
| PATCH | `/ticket-types/:id` | API Key | Ticketart aktualisieren |
| DELETE | `/ticket-types/:id` | API Key | Ticketart loeschen |

### Tickets / Registrierung

| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|-------------|
| POST | `/events/:id/register` | JWT | Tickets registrieren/kaufen |
| GET | `/me/tickets` | JWT | Eigene Tickets ueber alle Events auflisten |
| GET | `/tickets/:id` | JWT | Einzelnes Ticket abrufen |
| GET | `/tickets/:id/qr` | JWT | QR-Code als PNG Bild (lokal generiert) |
| POST | `/tickets/:id/void` | API Key | Ticket stornieren |

### Check-in

| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|-------------|
| POST | `/events/:id/checkin` | API Key | Einchecken per Ticket-ID oder QR-Daten |
| DELETE | `/events/:id/checkin/:ticketId` | API Key | Check-in rueckgaengig machen |
| GET | `/events/:id/attendees` | API Key | Teilnehmerliste mit Check-in Status |

### Webhooks

| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|-------------|
| POST | `/webhooks/stripe` | Stripe Signatur | Empfaengt Stripe Webhook Events |

---

## Ablauf-Diagramme

### Ablauf 1: Business verbindet Stripe (einmalig)

```
Dashboard → POST /api/v1/orgs/:id/connect-stripe
  → Service erstellt Stripe Express Connected Account
  → Gibt onboardingUrl zurueck (Stripe-gehostete Seite)
  → Business gibt Bankdaten/Identitaet auf Stripe ein
  → Stripe Webhook account.updated bestaetigt charges_enabled
  → Ab jetzt kann das Business bezahlte Tickets verkaufen
```

### Ablauf 2: Nutzer registriert sich fuer kostenloses Ticket

```
App → POST /api/v1/events/:id/register { name, email, ticketTypeId, quantity }
  → Kein Stripe noetig
  → Order wird sofort als "complete" erstellt
  → Tickets werden sofort als "active" erstellt mit QR-Daten
  → Nutzer kann sofort QR-Code abrufen
```

### Ablauf 3: Nutzer kauft bezahltes Ticket

```
App → POST /api/v1/events/:id/register { name, email, ticketTypeId, quantity }
  → Service prueft ob Business Stripe verbunden hat
  → Erstellt pending Order + pending Tickets
  → Erstellt Stripe Checkout Session mit application_fee_amount
  → Gibt checkoutUrl zurueck
  → App oeffnet URL im WebView → Stripe handhabt Zahlung
  → Stripe Webhook checkout.session.completed
    → Order wird auf "complete" gesetzt
    → Tickets werden auf "active" gesetzt
  → Nutzer kann QR-Code abrufen
```

### Ablauf 4: QR-Code Check-in am Veranstaltungsort

```
Scanner-App scannt QR-Code → extrahiert UUID
  → POST /api/v1/events/:id/checkin { qrData: "ticket-uuid" }
  → Rein lokale DB-Abfrage — kein externer API-Aufruf
  → Ticket-Status wird auf "checked_in" gesetzt
  → Gibt Teilnehmer-Info + Bestaetigung zurueck
```

---

## Stripe Connect — Zahlungsaufteilung

Jede Zahlung wird automatisch aufgeteilt:

```
Ticket-Preis: 20 EUR
Plattform-Gebuehr (10%): 2 EUR

→ Stripe zieht 20 EUR vom Kunden
→ 18 EUR gehen an das Stripe-Konto des Veranstalters
→ 2 EUR gehen an Pulsifys Stripe-Konto
→ Stripe behaelt seine eigene Gebuehr (~2.9% + 0.30) von den 20 EUR
```

Die Plattform-Gebuehr ist konfigurierbar ueber `STRIPE_PLATFORM_FEE_PERCENT`.

---

## Deployment auf Railway

### Schritt 1: Git Repository vorbereiten

```bash
cd pulsify-tickets
git init
git add .
git commit -m "Pulsify Ticket Service mit Stripe Connect"
# Auf GitHub pushen
```

### Schritt 2: Railway Projekt erstellen

1. Gehe zu [railway.app](https://railway.app) → "New Project"
2. **PostgreSQL hinzufuegen**: Klicke "New" → "Database" → "PostgreSQL"
3. **Service hinzufuegen**: "GitHub Repo" → waehle dein `pulsify-tickets` Repository
4. Railway erkennt automatisch das Dockerfile und baut den Service

### Schritt 3: Umgebungsvariablen setzen

| Variable | Wert |
|----------|------|
| `DATABASE_URL` | Klicke "Reference" → waehle die Postgres `DATABASE_URL` |
| `PORT` | `3000` |
| `APP_URL` | Die oeffentliche URL deines Railway-Service |
| `API_ADMIN_SECRET` | Starkes Secret generieren: `openssl rand -hex 32` |
| `STRIPE_SECRET_KEY` | Aus Stripe Dashboard → API Keys (`sk_test_...` oder `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | Wird beim Erstellen des Webhooks in Stripe gesetzt (`whsec_...`) |
| `STRIPE_PLATFORM_FEE_PERCENT` | `10` (oder gewuenschter Prozentsatz) |
| `JWT_SECRET` | Geteiltes Secret mit dem Pulsify Backend |

### Schritt 4: Datenbank-Schema erstellen

```bash
DATABASE_URL="postgresql://..." npx drizzle-kit push
```

### Schritt 5: Stripe Webhook konfigurieren

Im Stripe Dashboard:
1. Gehe zu Developers → Webhooks → "Add endpoint"
2. Endpoint URL: `https://DEINE-RAILWAY-URL/api/v1/webhooks/stripe`
3. Events auswaehlen: `checkout.session.completed`, `checkout.session.expired`, `account.updated`
4. Webhook Signing Secret kopieren → als `STRIPE_WEBHOOK_SECRET` setzen

---

## Testen nach dem Deployment

### 1. Health Check

```bash
curl https://DEINE-URL/health
# Erwartete Antwort: {"status":"ok","timestamp":"..."}
```

### 2. Organisation erstellen

```bash
curl -X POST https://DEINE-URL/api/v1/orgs \
  -H "Authorization: Bearer DEIN_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"name": "Meine Organisation"}'
```

### 3. Stripe Connect verbinden

```bash
curl -X POST https://DEINE-URL/api/v1/orgs/ORG_ID/connect-stripe \
  -H "Authorization: Bearer pk_DEIN_API_KEY"
# Gibt onboardingUrl zurueck → im Browser oeffnen
```

### 4. Event erstellen

```bash
curl -X POST https://DEINE-URL/api/v1/events \
  -H "Authorization: Bearer pk_DEIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Pulsify Launch Party",
    "startDate": "2026-04-15T19:00:00Z",
    "location": "Berlin, Kreuzberg",
    "ticketTypes": [
      {"name": "Kostenlos", "price": "0", "quantity": 100},
      {"name": "VIP", "price": "29.99", "quantity": 20}
    ]
  }'
```

### 5. Kostenloses Ticket registrieren

```bash
curl -X POST https://DEINE-URL/api/v1/events/EVENT_ID/register \
  -H "Authorization: Bearer USER_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Max Mustermann",
    "email": "max@example.com",
    "ticketTypeId": "TICKET_TYPE_ID",
    "quantity": 1
  }'
# Sofort abgeschlossen — tickets haben status "active"
```

### 6. Bezahltes Ticket kaufen

```bash
curl -X POST https://DEINE-URL/api/v1/events/EVENT_ID/register \
  -H "Authorization: Bearer USER_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Max Mustermann",
    "email": "max@example.com",
    "ticketTypeId": "VIP_TICKET_TYPE_ID",
    "quantity": 1
  }'
# Gibt checkoutUrl zurueck → im Browser/WebView oeffnen
# Nach Zahlung: Stripe Webhook aktiviert die Tickets automatisch
```

---

## Nutzung im Dashboard (Frontend)

```typescript
const API_BASE = 'https://pulsify-tickets.up.railway.app/api/v1';
const API_KEY = 'pk_...';

// Stripe Connect starten
const connectResp = await fetch(`${API_BASE}/orgs/${orgId}/connect-stripe`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${API_KEY}` }
});
const { onboardingUrl } = await connectResp.json();
// → onboardingUrl im Browser oeffnen

// Events laden
const response = await fetch(`${API_BASE}/events`, {
  headers: { 'Authorization': `Bearer ${API_KEY}` }
});
const { events } = await response.json();

// Teilnehmerliste mit Check-in Status
const attendeesResp = await fetch(`${API_BASE}/events/${eventId}/attendees`, {
  headers: { 'Authorization': `Bearer ${API_KEY}` }
});
const { attendees, summary } = await attendeesResp.json();
// summary = { total: 150, checkedIn: 45, pending: 105 }
```

## Nutzung in der React Native App

```typescript
const API_BASE = 'https://pulsify-tickets.up.railway.app/api/v1';

// Fuer ein Event registrieren
const registerResp = await fetch(`${API_BASE}/events/${eventId}/register`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${userJwtToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'Max Mustermann',
    email: 'max@example.com',
    ticketTypeId: 'uuid-der-ticketart',
    quantity: 1,
  }),
});
const { order, tickets, checkoutUrl } = await registerResp.json();
// Bei bezahlten Tickets: checkoutUrl im WebView oeffnen

// Meine Tickets abrufen
const ticketsResp = await fetch(`${API_BASE}/me/tickets`, {
  headers: { 'Authorization': `Bearer ${userJwtToken}` }
});

// QR-Code Bild abrufen (lokal generiert, kein externer Proxy)
const qrResp = await fetch(`${API_BASE}/tickets/${ticketId}/qr`, {
  headers: { 'Authorization': `Bearer ${userJwtToken}` }
});
// → PNG Bild des QR-Codes
```
