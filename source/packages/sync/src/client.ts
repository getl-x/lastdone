import type { PullResponse, PushResponse, SyncTransport } from "./types";
import type { SyncOperation } from "@lastdone/storage";

export interface HttpSyncTransportOptions {
  baseUrl?: string;
  getToken: () => string | null;
  fetch?: typeof globalThis.fetch;
}

export class HttpSyncTransport implements SyncTransport {
  readonly #baseUrl: string;
  readonly #getToken: () => string | null;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: HttpSyncTransportOptions) {
    this.#baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.#getToken = options.getToken;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async push(operations: SyncOperation[]): Promise<PushResponse> {
    return this.#request<PushResponse>("/api/lastdone/sync/push", {
      method: "POST",
      body: JSON.stringify({ operations }),
    });
  }

  async pull(after: number, limit: number): Promise<PullResponse> {
    const search = new URLSearchParams({
      after: String(after),
      limit: String(limit),
    });

    return this.#request<PullResponse>(`/api/lastdone/sync/pull?${search.toString()}`, {
      method: "GET",
    });
  }

  async #request<T>(path: string, init: RequestInit): Promise<T> {
    const token = this.#getToken();
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: token } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`sync request failed with status ${response.status}`);
    }

    return response.json() as Promise<T>;
  }
}
