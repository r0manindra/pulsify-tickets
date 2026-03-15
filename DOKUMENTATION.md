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

---

## Integrationsanleitung: Bestehendes System anbinden

Diese Anleitung beschreibt wie der Ticket Service in das bestehende Pulsify-System integriert wird, waehrend die Migration von .NET C# zu Hono TypeScript laeuft.

### Architektur-Ueberblick

```
┌──────────────────────┐         ┌────────────────────────────────┐
│  Pulsify Backend     │         │  Pulsify Ticket Service        │
│  (.NET C# / Railway) │────────>│  (Hono / Railway)              │
│                      │  HTTP   │  pulsify-tickets-production    │
│  - User Auth         │         │  .up.railway.app               │
│  - Business Logic    │         │                                │
│  - Org Management    │         │  Verwaltet:                    │
└──────────┬───────────┘         │  - Events + Ticketarten        │
           │                     │  - Bestellungen + Tickets      │
           │                     │  - Stripe Connect Zahlungen    │
           │                     │  - QR-Codes + Check-in         │
┌──────────┴───────────┐         └────────────────────────────────┘
│  Pulsify Dashboard   │                      ▲
│  (React/Next.js)     │──────────────────────┘
│                      │         ┌────────────────────────────────┐
│  Pulsify App         │         │  Stripe                        │
│  (React Native)      │────────>│  - Checkout (Zahlung)          │
└──────────────────────┘         │  - Connect (Business-Payouts)  │
                                 │  - Webhooks (Bestaetigung)     │
                                 └────────────────────────────────┘
```

**Wichtig:** Das .NET Backend ruft den Ticket Service mit dem `API_ADMIN_SECRET` oder dem `API Key` der Organisation auf. Die Mobile App ruft den Ticket Service direkt mit dem JWT des Users auf. Beide nutzen dasselbe `JWT_SECRET`.

---

### Phase 1: Backend-Integration (.NET C#)

#### 1.1 Org automatisch im Ticket Service erstellen

Wenn ein Business sich auf Pulsify registriert, muss das .NET Backend automatisch eine Organisation im Ticket Service erstellen und den API Key speichern.

```csharp
// In eurem BusinessRegistrationService oder aehnlich
public async Task<string> CreateTicketOrg(string businessName)
{
    var client = new HttpClient();
    client.DefaultRequestHeaders.Add("Authorization", $"Bearer {ADMIN_SECRET}");

    var response = await client.PostAsJsonAsync(
        "https://pulsify-tickets-production.up.railway.app/api/v1/orgs",
        new { name = businessName }
    );

    var result = await response.Content.ReadFromJsonAsync<OrgResponse>();

    // DIESEN API KEY IN EURER DB SPEICHERN!
    // z.B. in der Business-Tabelle: ticket_service_api_key, ticket_service_org_id
    return result.Organization.ApiKey;  // "pk_..."
}
```

**In eurer .NET Datenbank hinzufuegen (Business-Tabelle):**

| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| ticket_service_org_id | VARCHAR | UUID der Org im Ticket Service |
| ticket_service_api_key | VARCHAR | API Key (`pk_...`) fuer den Ticket Service |

#### 1.2 JWT Secret teilen

Beide Services muessen das gleiche `JWT_SECRET` verwenden, damit der Ticket Service die JWTs vom .NET Backend verifizieren kann.

**Wichtig:** Der JWT muss ein `sub` Claim mit der Pulsify User ID enthalten:

```csharp
// Im .NET Backend beim JWT erstellen
var claims = new[]
{
    new Claim(JwtRegisteredClaimNames.Sub, userId),  // MUSS "sub" sein
    // ... andere Claims
};
```

---

### Phase 2: Dashboard-Integration (React/Next.js)

Das Dashboard braucht 4 neue Features:

#### 2.1 API Client erstellen

```typescript
// lib/ticket-service.ts
const TICKET_API = 'https://pulsify-tickets-production.up.railway.app/api/v1';

export class TicketServiceClient {
  constructor(private apiKey: string) {}

  private async request(path: string, options?: RequestInit) {
    const res = await fetch(`${TICKET_API}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Ticket Service Error');
    }
    return res.json();
  }

  // --- Stripe Connect ---
  async connectStripe(orgId: string) {
    return this.request(`/orgs/${orgId}/connect-stripe`, { method: 'POST' });
  }

  async getStripeStatus(orgId: string) {
    return this.request(`/orgs/${orgId}/stripe-status`);
  }

  // --- Events ---
  async createEvent(data: {
    title: string;
    startDate: string;
    endDate?: string;
    location?: string;
    description?: string;
    ticketTypes?: { name: string; price: string; quantity?: number }[];
  }) {
    return this.request('/events', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getEvents() {
    return this.request('/events');
  }

  async getEvent(eventId: string) {
    return this.request(`/events/${eventId}`);
  }

  async updateEvent(eventId: string, data: Record<string, unknown>) {
    return this.request(`/events/${eventId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteEvent(eventId: string) {
    return this.request(`/events/${eventId}`, { method: 'DELETE' });
  }

  // --- Ticket Types ---
  async createTicketType(eventId: string, data: {
    name: string;
    price: string;
    quantity?: number;
  }) {
    return this.request(`/events/${eventId}/ticket-types`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getTicketTypes(eventId: string) {
    return this.request(`/events/${eventId}/ticket-types`);
  }

  // --- Attendees ---
  async getAttendees(eventId: string) {
    return this.request(`/events/${eventId}/attendees`);
  }

  // --- Check-in ---
  async checkin(eventId: string, data: { ticketId?: string; qrData?: string }) {
    return this.request(`/events/${eventId}/checkin`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async undoCheckin(eventId: string, ticketId: string) {
    return this.request(`/events/${eventId}/checkin/${ticketId}`, {
      method: 'DELETE',
    });
  }
}
```

#### 2.2 Feature: Stripe Connect Onboarding (Business Settings)

Auf der Business-Settings-Seite einen "Zahlungen verbinden" Button hinzufuegen:

```tsx
// components/StripeConnectButton.tsx
import { useState, useEffect } from 'react';

export function StripeConnectButton({ orgId, apiKey }: { orgId: string; apiKey: string }) {
  const [status, setStatus] = useState<'loading' | 'not_started' | 'pending' | 'complete'>('loading');
  const client = new TicketServiceClient(apiKey);

  useEffect(() => {
    client.getStripeStatus(orgId).then((res) => {
      setStatus(res.status);
    });
  }, [orgId]);

  const handleConnect = async () => {
    const { onboardingUrl } = await client.connectStripe(orgId);
    window.location.href = onboardingUrl; // Weiterleitung zu Stripe
  };

  if (status === 'loading') return <p>Laden...</p>;
  if (status === 'complete') return <p>Zahlungen verbunden</p>;

  return (
    <button onClick={handleConnect}>
      {status === 'pending' ? 'Onboarding fortsetzen' : 'Zahlungen verbinden'}
    </button>
  );
}
```

#### 2.3 Feature: Event erstellen mit Ticketarten

```tsx
// pages/events/create.tsx (vereinfacht)
async function handleCreateEvent(formData: EventFormData) {
  const client = new TicketServiceClient(business.ticketServiceApiKey);

  const { event } = await client.createEvent({
    title: formData.title,
    startDate: formData.startDate,
    endDate: formData.endDate,
    location: formData.location,
    description: formData.description,
    ticketTypes: formData.ticketTypes.map((tt) => ({
      name: tt.name,
      price: tt.price.toString(),
      quantity: tt.quantity,
    })),
  });

  // Event-ID auch im .NET Backend speichern fuer Referenz
  await savePulsifyEventRef(event.id);

  router.push(`/events/${event.id}`);
}
```

#### 2.4 Feature: Teilnehmerliste + Check-in

```tsx
// pages/events/[id]/attendees.tsx
export function AttendeesPage({ eventId, apiKey }: Props) {
  const [data, setData] = useState<{ attendees: Attendee[]; summary: Summary } | null>(null);
  const client = new TicketServiceClient(apiKey);

  useEffect(() => {
    client.getAttendees(eventId).then(setData);
  }, [eventId]);

  if (!data) return <p>Laden...</p>;

  return (
    <div>
      <h2>Teilnehmer</h2>
      <div>
        <span>Gesamt: {data.summary.total}</span>
        <span>Eingecheckt: {data.summary.checkedIn}</span>
        <span>Ausstehend: {data.summary.pending}</span>
      </div>

      <table>
        <thead>
          <tr><th>Name</th><th>E-Mail</th><th>Status</th><th>Referenz</th></tr>
        </thead>
        <tbody>
          {data.attendees.map((a) => (
            <tr key={a.ticketId}>
              <td>{a.name}</td>
              <td>{a.email}</td>
              <td>{a.status}</td>
              <td>{a.ticketReference}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

---

### Phase 3: Mobile App Integration (React Native)

Die App braucht 3 neue Features:

#### 3.1 API Client erstellen

```typescript
// services/ticketApi.ts
import { getAuthToken } from './auth'; // Euer bestehendes Auth-System

const TICKET_API = 'https://pulsify-tickets-production.up.railway.app/api/v1';

async function ticketRequest(path: string, options?: RequestInit) {
  const token = await getAuthToken(); // JWT vom .NET Backend

  const res = await fetch(`${TICKET_API}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Ticket Service Error');
  }
  return res.json();
}

// Event-Details + Ticketarten laden (oeffentlich, kein Auth noetig)
export async function getEvent(eventId: string) {
  const res = await fetch(`${TICKET_API}/events/${eventId}`);
  return res.json();
}

// Ticket kaufen/registrieren
export async function registerForEvent(eventId: string, data: {
  name: string;
  email: string;
  ticketTypeId: string;
  quantity: number;
}) {
  return ticketRequest(`/events/${eventId}/register`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Meine Tickets laden
export async function getMyTickets() {
  return ticketRequest('/me/tickets');
}

// Einzelnes Ticket laden
export async function getTicket(ticketId: string) {
  return ticketRequest(`/tickets/${ticketId}`);
}

// QR-Code als Bild-URL
export function getQrCodeUrl(ticketId: string) {
  // Hinweis: Dieser Endpoint braucht Auth im Header,
  // daher besser als fetch mit Auth-Header laden (siehe TicketScreen)
  return `${TICKET_API}/tickets/${ticketId}/qr`;
}
```

#### 3.2 Feature: Event-Detail Screen mit "Ticket kaufen"

```tsx
// screens/EventDetailScreen.tsx
import { WebView } from 'react-native-webview';
import { registerForEvent, getEvent } from '../services/ticketApi';

export function EventDetailScreen({ eventId }) {
  const [event, setEvent] = useState(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  useEffect(() => {
    getEvent(eventId).then((res) => setEvent(res.event));
  }, [eventId]);

  const handleBuyTicket = async (ticketTypeId: string) => {
    const { order, tickets, checkoutUrl } = await registerForEvent(eventId, {
      name: user.name,
      email: user.email,
      ticketTypeId,
      quantity: 1,
    });

    if (checkoutUrl) {
      // Bezahltes Ticket → Stripe Checkout im WebView oeffnen
      setCheckoutUrl(checkoutUrl);
    } else {
      // Kostenloses Ticket → sofort fertig
      Alert.alert('Ticket erhalten!', `Referenz: ${tickets[0].ticketReference}`);
      navigation.navigate('MyTickets');
    }
  };

  // Stripe Checkout WebView
  if (checkoutUrl) {
    return (
      <WebView
        source={{ uri: checkoutUrl }}
        onNavigationStateChange={(navState) => {
          // Wenn Stripe zurueckleitet (success oder cancel URL)
          if (navState.url.includes('/success') || navState.url.includes('/cancel')) {
            setCheckoutUrl(null);
            navigation.navigate('MyTickets');
          }
        }}
      />
    );
  }

  if (!event) return <ActivityIndicator />;

  return (
    <View>
      <Text style={styles.title}>{event.title}</Text>
      <Text>{event.location}</Text>
      <Text>{new Date(event.startDate).toLocaleDateString('de')}</Text>

      <Text style={styles.subtitle}>Tickets</Text>
      {event.ticketTypes.map((tt) => (
        <TouchableOpacity key={tt.id} onPress={() => handleBuyTicket(tt.id)}>
          <View style={styles.ticketCard}>
            <Text>{tt.name}</Text>
            <Text>{Number(tt.price) === 0 ? 'Kostenlos' : `${tt.price} ${tt.currency}`}</Text>
            <Text>{tt.available !== null ? `${tt.available} verfuegbar` : 'Unbegrenzt'}</Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}
```

#### 3.3 Feature: Meine Tickets mit QR-Code

```tsx
// screens/MyTicketsScreen.tsx
import { getMyTickets } from '../services/ticketApi';

export function MyTicketsScreen() {
  const [tickets, setTickets] = useState([]);

  useEffect(() => {
    getMyTickets().then((res) => setTickets(res.tickets));
  }, []);

  return (
    <FlatList
      data={tickets}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <TouchableOpacity onPress={() => navigation.navigate('TicketDetail', { id: item.id })}>
          <View style={styles.ticketCard}>
            <Text style={styles.eventTitle}>{item.event.title}</Text>
            <Text>{item.ticketType}</Text>
            <Text>Ref: {item.ticketReference}</Text>
            <View style={[
              styles.statusBadge,
              { backgroundColor: item.status === 'active' ? '#4CAF50' : '#9E9E9E' }
            ]}>
              <Text style={styles.statusText}>{item.status}</Text>
            </View>
          </View>
        </TouchableOpacity>
      )}
    />
  );
}
```

```tsx
// screens/TicketDetailScreen.tsx
import { getAuthToken } from '../services/auth';

export function TicketDetailScreen({ ticketId }) {
  const [ticket, setTicket] = useState(null);
  const [qrImage, setQrImage] = useState<string | null>(null);

  useEffect(() => {
    getTicket(ticketId).then((res) => setTicket(res.ticket));
    loadQrCode();
  }, [ticketId]);

  const loadQrCode = async () => {
    const token = await getAuthToken();
    const res = await fetch(
      `https://pulsify-tickets-production.up.railway.app/api/v1/tickets/${ticketId}/qr`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const blob = await res.blob();
    const reader = new FileReader();
    reader.onload = () => setQrImage(reader.result as string);
    reader.readAsDataURL(blob);
  };

  if (!ticket) return <ActivityIndicator />;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{ticket.name}</Text>
      <Text>Referenz: {ticket.ticketReference}</Text>
      <Text>Status: {ticket.status}</Text>

      {qrImage && (
        <Image source={{ uri: qrImage }} style={{ width: 300, height: 300 }} />
      )}

      <Text style={styles.hint}>
        Zeige diesen QR-Code beim Einlass vor
      </Text>
    </View>
  );
}
```

---

### Zusammenfassung: Was muss wo gemacht werden

#### .NET C# Backend (minimal, 2 Aenderungen)

| # | Aufgabe | Beschreibung |
|---|---------|-------------|
| 1 | DB-Spalten hinzufuegen | `ticket_service_org_id` + `ticket_service_api_key` in Business-Tabelle |
| 2 | Auto-Provisioning | Bei Business-Registrierung: `POST /orgs` aufrufen, API Key speichern |

#### Dashboard (React/Next.js, 4 Features)

| # | Feature | Seite | Beschreibung |
|---|---------|-------|-------------|
| 1 | Stripe Connect | Business Settings | "Zahlungen verbinden" Button → oeffnet Stripe Onboarding |
| 2 | Events verwalten | Events-Seite | CRUD fuer Events + Ticketarten ueber Ticket Service API |
| 3 | Teilnehmerliste | Event-Detail | Zeigt Teilnehmer, Check-in Status, Zusammenfassung |
| 4 | Check-in Tool | Event-Detail | QR-Scanner oder manuelle Eingabe fuer Check-in |

#### Mobile App (React Native, 3 Features)

| # | Feature | Screen | Beschreibung |
|---|---------|--------|-------------|
| 1 | Ticket kaufen | Event-Detail | Ticketart waehlen, kostenlos → sofort, bezahlt → Stripe WebView |
| 2 | Meine Tickets | Tab/Screen | Liste aller Tickets mit Status |
| 3 | QR-Code anzeigen | Ticket-Detail | QR-Code Bild vom Ticket Service laden + anzeigen |

#### Reihenfolge der Implementierung

```
1. Backend: DB-Spalten + Auto-Provisioning        (1 Tag)
2. Dashboard: API Client + Stripe Connect Button   (1 Tag)
3. Dashboard: Event-Verwaltung                     (1-2 Tage)
4. App: Ticket kaufen + Stripe WebView             (1-2 Tage)
5. App: Meine Tickets + QR-Code                    (1 Tag)
6. Dashboard: Teilnehmerliste + Check-in           (1 Tag)
```

Alles kann parallel entwickelt werden, weil der Ticket Service bereits laeuft und getestet ist.
