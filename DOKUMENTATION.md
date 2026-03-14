# Pulsify Ticket Service — Dokumentation

## Was ist das?

Der **Pulsify Ticket Service** ist ein eigenstaendiger Microservice, der als Wrapper um die **Tito API** (ti.to) fungiert. Er stellt saubere, Pulsify-spezifische Endpoints bereit, die von der React Native App und dem Business-Dashboard genutzt werden.

**Warum Tito?**
- 3% Gebuehr nur bei bezahlten Tickets (kostenlose Tickets = kostenlos)
- Automatische QR-Codes fuer jedes Ticket
- Stripe Connect eingebaut (Zahlungsabwicklung komplett durch Tito)
- Vollstaendige REST API + Webhooks
- Check-in System mit QR-Scanner-Unterstuetzung

**Warum ein eigener Wrapper-Service?**
- Pulsify braucht eigene User-IDs, eigene Datenstruktur, schnelle Reads
- Tito ist das externe System — unsere Postgres-DB ist die lokale Wahrheit
- Entkoppelt die Frontend-Entwicklung von Tito-spezifischen Details
- Kann spaeter ins neue Backend absorbiert oder als Microservice weiterlaufen

---

## Architektur

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────┐
│  Pulsify App        │     │  Pulsify Ticket       │     │  Tito API   │
│  (React Native)     │────>│  Service (Hono)       │────>│  (ti.to)    │
│  + Dashboard        │     │  Railway              │     │             │
└─────────────────────┘     └──────────────────────┘     └─────────────┘
                                  │         ▲
                                  │         │
                                  ▼         │
                            ┌──────────┐  Webhooks
                            │ Postgres │  von Tito
                            │ (Railway)│
                            └──────────┘
```

**Der Service macht 3 Dinge:**
1. **Uebersetzt** Pulsifys Datenmodell in Titos API-Format (und zurueck)
2. **Cached** Event-/Ticket-Daten in eigener Postgres fuer schnelle Reads
3. **Empfaengt Webhooks** von Tito um lokale Daten synchron zu halten

---

## Tech Stack

| Komponente | Technologie |
|------------|-------------|
| Runtime | Node.js 20+ |
| Framework | Hono (leichtgewichtig, schnell) |
| Datenbank | PostgreSQL (Railway) |
| ORM | Drizzle (type-safe, SQL-nah) |
| Auth | API Key (Server-to-Server), JWT (Endnutzer) |
| Externe API | Tito Admin API v3 |
| Check-in | Tito Check-in API |
| QR-Codes | Von Tito generiert |
| Zahlungen | Komplett durch Tito + Stripe Connect |
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
│   │   ├── events.ts            # Event CRUD (→ Tito Events + Releases)
│   │   ├── tickets.ts           # Ticket-Kauf/Listing (→ Tito Registrierungen)
│   │   ├── ticket-types.ts      # Ticketarten (→ Tito Releases)
│   │   ├── checkin.ts           # QR-Scan + Check-in (→ Tito Check-in API)
│   │   ├── organizations.ts     # Org-Verwaltung + Tito-Anbindung
│   │   └── webhooks.ts          # Tito Webhook-Empfaenger
│   ├── services/
│   │   ├── tito.ts              # Tito API Client (fetch-basiert)
│   │   └── sync.ts              # Webhook → lokale DB Synchronisation
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

Die lokale Postgres cached Tito-Daten und speichert Pulsify-spezifische Felder.

### Tabelle: `organizations`
| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| id | UUID (PK) | Automatisch generiert |
| name | TEXT | Organisationsname |
| tito_account_slug | TEXT | Tito Account Slug |
| tito_api_token | TEXT | Tito API Token (verschluesselt speichern!) |
| stripe_account_id | TEXT | Stripe Connected Account ID |
| api_key | TEXT (unique) | API Key fuer diese Organisation |
| created_at | TIMESTAMP | Erstellungsdatum |

### Tabelle: `events`
| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| id | UUID (PK) | Automatisch generiert |
| organization_id | UUID (FK) | Referenz auf organizations |
| tito_event_slug | TEXT | Tito Event Slug |
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
| tito_release_id | TEXT | Tito Release ID |
| tito_release_slug | TEXT | Tito Release Slug |
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
| tito_registration_id | TEXT | Tito Registrierungs-ID |
| tito_reference | TEXT | Referenzcode (z.B. "ABCD") |
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
| tito_ticket_id | TEXT | Tito Ticket ID |
| tito_ticket_slug | TEXT | Tito Ticket Slug |
| tito_reference | TEXT | 4-Zeichen Code (z.B. "ABCD-1") |
| qr_code_url | TEXT | URL zum QR-Code Bild |
| name | TEXT | Name des Ticketinhabers |
| email | TEXT | E-Mail des Ticketinhabers |
| status | TEXT | active, checked_in, voided, cancelled |
| checked_in_at | TIMESTAMP | Check-in Zeitpunkt |

---

## API Endpoints

Alle Endpoints unter `/api/v1`. Authentifizierung ueber `Authorization: Bearer <token>`.

### Authentifizierung

| Aufrufer | Methode | Details |
|----------|---------|---------|
| Dashboard / Backend | API Key | Jede Org bekommt einen einzigartigen API Key (`pk_...`). Wird als Bearer Token gesendet. |
| Endnutzer (App) | JWT | Pulsifys bestehendes Auth-System stellt JWTs aus. Der Service verifiziert sie mit einem geteilten Secret. |
| Tito Webhooks | HMAC-SHA256 | Verifizierung des `Tito-Signature` Headers. |
| Admin (Org erstellen) | Admin Secret | Spezieller Secret fuer das Erstellen neuer Organisationen. |

### Organisation / Setup

| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|-------------|
| POST | `/orgs` | Admin Secret | Neue Organisation registrieren, API Key generieren |
| GET | `/orgs/:id` | API Key | Org-Details abrufen |
| POST | `/orgs/:id/connect-tito` | API Key | Tito Account Slug + API Token hinterlegen |

### Events

| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|-------------|
| POST | `/events` | API Key | Event erstellen (→ erstellt auch Tito Event) |
| GET | `/events` | API Key | Alle Events der Organisation auflisten |
| GET | `/events/:id` | Oeffentlich | Event-Details + Ticketarten abrufen |
| PATCH | `/events/:id` | API Key | Event aktualisieren (→ aktualisiert Tito) |
| DELETE | `/events/:id` | API Key | Event loeschen |

### Ticketarten (Tito Releases)

| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|-------------|
| POST | `/events/:id/ticket-types` | API Key | Ticketart erstellen (→ Tito Release) |
| GET | `/events/:id/ticket-types` | Oeffentlich | Verfuegbare Ticketarten + Verfuegbarkeit |
| PATCH | `/ticket-types/:id` | API Key | Ticketart aktualisieren |
| DELETE | `/ticket-types/:id` | API Key | Ticketart loeschen |

### Tickets / Registrierung

| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|-------------|
| POST | `/events/:id/register` | JWT | Tickets registrieren/kaufen (→ Tito Registrierung) |
| GET | `/me/tickets` | JWT | Eigene Tickets ueber alle Events auflisten |
| GET | `/tickets/:id` | JWT | Einzelnes Ticket mit QR-Code URL |
| GET | `/tickets/:id/qr` | JWT | QR-Code Bild (von Tito proxied) |
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
| POST | `/webhooks/tito` | HMAC Signatur | Empfaengt Tito Webhook Events, synchronisiert lokale DB |

---

## Ablauf-Diagramme

### Ablauf 1: Veranstalter erstellt ein Event

```
Dashboard → POST /api/v1/events { title, date, location, ticketTypes[] }
  → Service erstellt Tito Event via POST /v3/:account/events
  → Service erstellt Tito Releases fuer jede Ticketart
  → Service speichert Event + Ticketarten in lokaler Postgres
  → Gibt Event mit Ticketarten an Dashboard zurueck
```

### Ablauf 2: Nutzer registriert sich / kauft Tickets

**Option A — Tito Widget (empfohlen fuer Web):**
```
App zeigt Tito Widget → Tito handhabt Checkout + Stripe Zahlung
  → Tito sendet Webhook (registration.finished + ticket.completed)
  → Service empfaengt Webhook, speichert Order + Tickets in lokaler DB
  → App ruft GET /me/tickets ab oder wartet auf Push-Benachrichtigung
```

**Option B — API-gesteuert (fuer React Native In-App Flow):**
```
App → POST /api/v1/events/:id/register { name, email, ticketTypeId, quantity }
  → Service erstellt Tito Registrierung via Admin API
  → Fuer KOSTENLOSE Tickets: Registrierung sofort abgeschlossen
  → Fuer BEZAHLTE Tickets: Service gibt Tito Checkout-URL zurueck
    → App oeffnet URL im WebView → Tito handhabt Stripe-Zahlung
    → Webhook bestaetigt Abschluss
  → Service synchronisiert Order + Tickets in lokale DB
```

### Ablauf 3: QR-Code Check-in am Veranstaltungsort

```
Scanner-App scannt QR-Code → extrahiert Ticket-Slug aus URL
  → POST /api/v1/events/:id/checkin { ticketSlug }
  → Service ruft Tito Check-in API auf
  → Service aktualisiert lokalen Ticket-Status auf 'checked_in'
  → Gibt Teilnehmer-Info + Bestaetigung zurueck
```

---

## Deployment auf Railway

### Schritt 1: Git Repository vorbereiten

```bash
cd pulsify-tickets
git init
git add .
git commit -m "Initial commit: Pulsify Ticket Service"
# Auf GitHub pushen (neues Repository erstellen)
```

### Schritt 2: Railway Projekt erstellen

1. Gehe zu [railway.app](https://railway.app) → "New Project"
2. **PostgreSQL hinzufuegen**: Klicke "New" → "Database" → "PostgreSQL"
3. **Service hinzufuegen**: "GitHub Repo" → waehle dein `pulsify-tickets` Repository
4. Railway erkennt automatisch das Dockerfile und baut den Service

### Schritt 3: Umgebungsvariablen setzen

In den Railway Service-Einstellungen:

| Variable | Wert |
|----------|------|
| `DATABASE_URL` | Klicke "Reference" → waehle die Postgres `DATABASE_URL` |
| `PORT` | `3000` |
| `API_ADMIN_SECRET` | Starkes Secret generieren: `openssl rand -hex 32` |
| `TITO_API_TOKEN` | Aus Tito Account → Admin → API Access |
| `TITO_ACCOUNT_SLUG` | Dein Tito Org-Slug (Teil in `ti.to/dein-slug`) |
| `TITO_WEBHOOK_SECRET` | Wird beim Erstellen des Webhooks in Tito gesetzt |
| `JWT_SECRET` | Geteiltes Secret mit dem Pulsify Backend |

### Schritt 4: Datenbank-Schema erstellen

Nach dem Deploy, in der Railway Shell oder lokal:

```bash
DATABASE_URL="postgresql://..." npx drizzle-kit push
```

### Schritt 5: Tito Webhook konfigurieren

In deinem Tito Account:
1. Gehe zu deinem Event → Settings → Webhooks
2. Endpoint URL: `https://DEINE-RAILWAY-URL/api/v1/webhooks/tito`
3. Waehle Events: `registration.finished`, `ticket.completed`, `ticket.voided`, `registration.cancelled`, `checkin.created`
4. Setze den Security Token (gleicher Wert wie `TITO_WEBHOOK_SECRET`)

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

# Antwort:
# {
#   "organization": {
#     "id": "uuid...",
#     "name": "Meine Organisation",
#     "apiKey": "pk_abc123...",   ← DIESEN KEY MERKEN!
#     ...
#   }
# }
```

### 3. Tito verbinden

```bash
curl -X POST https://DEINE-URL/api/v1/orgs/ORG_ID/connect-tito \
  -H "Authorization: Bearer pk_DEIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "titoAccountSlug": "dein-tito-slug",
    "titoApiToken": "dein-tito-api-token"
  }'
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

### 5. Events auflisten

```bash
curl https://DEINE-URL/api/v1/events \
  -H "Authorization: Bearer pk_DEIN_API_KEY"
```

### 6. Ticketarten eines Events abrufen (oeffentlich)

```bash
curl https://DEINE-URL/api/v1/events/EVENT_ID/ticket-types
```

---

## Nutzung im Dashboard (Frontend)

Im Business-Dashboard wird der API Key der Organisation verwendet:

```typescript
// Beispiel: API Client im Dashboard
const API_BASE = 'https://pulsify-tickets.up.railway.app/api/v1';
const API_KEY = 'pk_...'; // Aus der Org-Erstellung

// Events laden
const response = await fetch(`${API_BASE}/events`, {
  headers: { 'Authorization': `Bearer ${API_KEY}` }
});
const { events } = await response.json();

// Neues Event erstellen
const createResponse = await fetch(`${API_BASE}/events`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    title: 'Mein Event',
    startDate: '2026-05-01T18:00:00Z',
    location: 'Muenchen',
    ticketTypes: [
      { name: 'Standard', price: '15.00', quantity: 200 }
    ]
  }),
});

// Teilnehmerliste mit Check-in Status
const attendeesResp = await fetch(`${API_BASE}/events/${eventId}/attendees`, {
  headers: { 'Authorization': `Bearer ${API_KEY}` }
});
const { attendees, summary } = await attendeesResp.json();
// summary = { total: 150, checkedIn: 45, pending: 105 }
```

## Nutzung in der React Native App

In der App wird das JWT des eingeloggten Users verwendet:

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
const { tickets: myTickets } = await ticketsResp.json();
// Jedes Ticket hat: qrCodeUrl, event.title, ticketType, status

// QR-Code Bild abrufen
const qrResp = await fetch(`${API_BASE}/tickets/${ticketId}/qr`, {
  headers: { 'Authorization': `Bearer ${userJwtToken}` }
});
// → PNG Bild des QR-Codes
```

---

## Stripe / Zahlungen

**Kein Stripe-Code in unserem Service noetig!**

Tito handhabt alles:
1. Veranstalter verbindet Stripe in seinem Tito Account (Settings → Payment → Connect Stripe)
2. Tito nutzt Stripe Connect OAuth
3. Wenn Teilnehmer Tickets kaufen, verarbeitet Tito die Zahlung ueber das Stripe-Konto des Veranstalters
4. Tito nimmt 3% Gebuehr, Rest geht an den Veranstalter per Stripe Payout

**Unser Service braucht nur den Tito Account Slug — keine Stripe-Zugangsdaten.**

---

## Webhook-Events die verarbeitet werden

| Tito Event | Aktion |
|------------|--------|
| `registration.finished` | Neue Order + Tickets in lokaler DB anlegen |
| `ticket.completed` | Ticket-Details aktualisieren (Name, E-Mail) |
| `ticket.voided` | Ticket-Status auf "voided" setzen |
| `registration.cancelled` | Order + zugehoerige Tickets auf "cancelled" setzen |
| `checkin.created` | Ticket-Status auf "checked_in" setzen |

---

## Zukunftsplanung

Wenn das neue Pulsify TypeScript-Backend fertig ist:

**Option A — Als Microservice beibehalten:**
Der Ticket Service bleibt auf Railway. Das neue Backend ruft ihn intern auf. Saubere Microservice-Grenze.

**Option B — Ins Monolith absorbieren:**
Routes, Services und Schema ins neue Backend kopieren. Das Drizzle-Schema und die Hono-Routes lassen sich leicht nach Express/Fastify portieren. Der Tito Client ist framework-unabhaengig.

**Beides funktioniert, weil:**
- Die lokale Postgres ist die Wahrheit fuer Pulsify (Tito ist das externe System)
- Alle Geschaeftslogik ist in purem TypeScript, nicht an Hono gekoppelt
- Der Tito Client ist eine eigenstaendige Klasse ohne Framework-Abhaengigkeiten
- Wenn man Tito spaeter ersetzen will, tauscht man nur den Tito Client aus — die API-Endpoints bleiben gleich
