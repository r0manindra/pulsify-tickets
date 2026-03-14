export interface TitoEvent {
  slug: string;
  title: string;
  description?: string;
  location?: string;
  start_date?: string;
  end_date?: string;
  currency?: string;
  live?: boolean;
  url?: string;
  [key: string]: unknown;
}

export interface TitoRelease {
  id: number;
  slug: string;
  title: string;
  price?: number;
  quantity?: number;
  tickets_count?: number;
  [key: string]: unknown;
}

export interface TitoRegistration {
  id: number;
  slug: string;
  reference: string;
  name: string;
  email: string;
  total: string;
  currency: string;
  state: string;
  completed_at?: string;
  tickets?: TitoTicket[];
  receipt?: { url: string };
  [key: string]: unknown;
}

export interface TitoTicket {
  id: number;
  slug: string;
  reference: string;
  name?: string;
  email?: string;
  release_slug?: string;
  release_title?: string;
  state?: string;
  void?: boolean;
  [key: string]: unknown;
}

export interface TitoCheckin {
  id: number;
  ticket_id: number;
  checkin_list_id: number;
  created_at: string;
  deleted_at?: string;
  uuid?: string;
  [key: string]: unknown;
}

export interface TitoWebhookPayload {
  trigger: string;
  event?: string;
  [key: string]: unknown;
}

export interface AuthPayload {
  type: 'api_key' | 'jwt';
  organizationId?: string;
  userId?: string;
}
