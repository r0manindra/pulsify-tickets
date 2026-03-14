export class TitoApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Tito API error ${status}: ${JSON.stringify(body)}`);
    this.name = 'TitoApiError';
  }
}

export class TitoClient {
  constructor(
    private token: string,
    private accountSlug: string,
    private baseUrl = 'https://api.tito.io/v3',
    private checkinBaseUrl = 'https://checkin.tito.io',
  ) {}

  private async request<T = unknown>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}/${this.accountSlug}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Token token=${this.token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = await res.text();
      }
      throw new TitoApiError(res.status, body);
    }
    if (res.status === 204) return null as T;
    return res.json() as Promise<T>;
  }

  private async checkinRequest<T = unknown>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.checkinBaseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Token token=${this.token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = await res.text();
      }
      throw new TitoApiError(res.status, body);
    }
    if (res.status === 204) return null as T;
    return res.json() as Promise<T>;
  }

  // --- Events ---

  async createEvent(data: Record<string, unknown>) {
    return this.request<{ event: Record<string, unknown> }>('/events', {
      method: 'POST',
      body: JSON.stringify({ event: data }),
    });
  }

  async getEvent(eventSlug: string) {
    return this.request<{ event: Record<string, unknown> }>(`/${eventSlug}`);
  }

  async updateEvent(eventSlug: string, data: Record<string, unknown>) {
    return this.request<{ event: Record<string, unknown> }>(`/${eventSlug}`, {
      method: 'PATCH',
      body: JSON.stringify({ event: data }),
    });
  }

  async deleteEvent(eventSlug: string) {
    return this.request(`/${eventSlug}`, { method: 'DELETE' });
  }

  // --- Releases (Ticket Types) ---

  async createRelease(eventSlug: string, data: Record<string, unknown>) {
    return this.request<{ release: Record<string, unknown> }>(`/${eventSlug}/releases`, {
      method: 'POST',
      body: JSON.stringify({ release: data }),
    });
  }

  async listReleases(eventSlug: string) {
    return this.request<{ releases: Record<string, unknown>[] }>(`/${eventSlug}/releases`);
  }

  async getRelease(eventSlug: string, releaseSlug: string) {
    return this.request<{ release: Record<string, unknown> }>(`/${eventSlug}/releases/${releaseSlug}`);
  }

  async updateRelease(eventSlug: string, releaseSlug: string, data: Record<string, unknown>) {
    return this.request<{ release: Record<string, unknown> }>(`/${eventSlug}/releases/${releaseSlug}`, {
      method: 'PATCH',
      body: JSON.stringify({ release: data }),
    });
  }

  async deleteRelease(eventSlug: string, releaseSlug: string) {
    return this.request(`/${eventSlug}/releases/${releaseSlug}`, { method: 'DELETE' });
  }

  // --- Registrations (Orders) ---

  async createRegistration(eventSlug: string, data: Record<string, unknown>) {
    return this.request<{ registration: Record<string, unknown> }>(`/${eventSlug}/registrations`, {
      method: 'POST',
      body: JSON.stringify({ registration: data }),
    });
  }

  async listRegistrations(eventSlug: string, params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.request<{ registrations: Record<string, unknown>[] }>(`/${eventSlug}/registrations${query}`);
  }

  async getRegistration(eventSlug: string, registrationSlug: string) {
    return this.request<{ registration: Record<string, unknown> }>(`/${eventSlug}/registrations/${registrationSlug}`);
  }

  async cancelRegistration(eventSlug: string, registrationSlug: string) {
    return this.request(`/${eventSlug}/registrations/${registrationSlug}`, {
      method: 'PATCH',
      body: JSON.stringify({ registration: { state: 'cancelled' } }),
    });
  }

  // --- Tickets ---

  async listTickets(eventSlug: string, params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.request<{ tickets: Record<string, unknown>[] }>(`/${eventSlug}/tickets${query}`);
  }

  async getTicket(eventSlug: string, ticketSlug: string) {
    return this.request<{ ticket: Record<string, unknown> }>(`/${eventSlug}/tickets/${ticketSlug}`);
  }

  async voidTicket(eventSlug: string, ticketSlug: string) {
    return this.request(`/${eventSlug}/tickets/${ticketSlug}/void`, {
      method: 'POST',
    });
  }

  // --- Check-in Lists ---

  async listCheckinLists(eventSlug: string) {
    return this.request<{ checkin_lists: Record<string, unknown>[] }>(`/${eventSlug}/checkin_lists`);
  }

  // --- Check-in (uses checkin API base URL) ---

  async checkin(checkinListSlug: string, ticketSlug: string) {
    return this.checkinRequest<Record<string, unknown>>(
      `/checkin_lists/${checkinListSlug}/checkins`,
      {
        method: 'POST',
        body: JSON.stringify({ checkin: { ticket_id: ticketSlug } }),
      },
    );
  }

  async deleteCheckin(checkinListSlug: string, checkinId: string) {
    return this.checkinRequest(
      `/checkin_lists/${checkinListSlug}/checkins/${checkinId}`,
      { method: 'DELETE' },
    );
  }

  async listCheckins(checkinListSlug: string) {
    return this.checkinRequest<Record<string, unknown>[]>(
      `/checkin_lists/${checkinListSlug}/checkins`,
    );
  }
}
