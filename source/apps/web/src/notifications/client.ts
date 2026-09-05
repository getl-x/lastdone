export type NotificationPlatform = "web" | "ios-pwa";
export type NotificationStatus = "unsupported" | "denied" | "disabled" | "enabled";

export interface NotificationPreferences {
  digestEnabled: boolean;
  importantRemindersEnabled: boolean;
}

export interface NotificationDeviceState extends NotificationPreferences {
  deviceId: string;
  deviceName: string;
  platform: NotificationPlatform | "android";
  enabled: boolean;
  status: NotificationStatus;
}

export interface PushSubscriptionLike {
  endpoint: string;
  toJSON(): {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  getKey?(name: "p256dh" | "auth"): ArrayBuffer | null;
  unsubscribe(): Promise<boolean>;
}

export interface PushRuntime {
  supported: boolean;
  platform: NotificationPlatform;
  deviceName: string;
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  getSubscription(): Promise<PushSubscriptionLike | null>;
  subscribe(options: {
    userVisibleOnly: true;
    applicationServerKey: Uint8Array<ArrayBuffer>;
  }): Promise<PushSubscriptionLike>;
}

export interface NotificationClient {
  inspect(): Promise<
    | NotificationDeviceState
    | { status: Exclude<NotificationStatus, "enabled">; platform: NotificationPlatform }
  >;
  enable(
    preferences?: NotificationPreferences,
  ): Promise<
    | NotificationDeviceState
    | { status: "unsupported" | "denied"; platform: NotificationPlatform }
  >;
  disable(): Promise<
    | NotificationDeviceState
    | { status: "unsupported" | "disabled"; platform: NotificationPlatform }
  >;
  listDevices(): Promise<NotificationDeviceState[]>;
  updatePreferences(
    deviceId: string,
    preferences: NotificationPreferences,
  ): Promise<NotificationDeviceState>;
}

interface BrowserNotificationClientOptions {
  getToken: () => string | null;
  fetch?: typeof globalThis.fetch;
  runtime?: PushRuntime;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  baseUrl?: string;
}

interface ServerDeviceState extends NotificationPreferences {
  deviceId: string;
  deviceName: string;
  platform: NotificationPlatform | "android";
  enabled: boolean;
}

const DEVICE_ID_KEY = "lastdone_device_id";

export function notificationDefaults(
  platform: NotificationPlatform,
): NotificationPreferences {
  return platform === "ios-pwa"
    ? { digestEnabled: true, importantRemindersEnabled: true }
    : { digestEnabled: false, importantRemindersEnabled: false };
}

function isIOS(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  const safariNavigator = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    safariNavigator.standalone === true
  );
}

export function createBrowserPushRuntime(): PushRuntime {
  const supported =
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window;
  const platform: NotificationPlatform =
    supported && isIOS() && isStandalone() ? "ios-pwa" : "web";
  const registration = () => navigator.serviceWorker.ready;

  return {
    supported,
    platform,
    deviceName: platform === "ios-pwa" ? "iPhone PWA" : "电脑浏览器",
    permission: () => (supported ? Notification.permission : "default"),
    requestPermission: () => Notification.requestPermission(),
    async getSubscription() {
      return (await (
        await registration()
      ).pushManager.getSubscription()) as PushSubscriptionLike | null;
    },
    async subscribe(options) {
      return (await (
        await registration()
      ).pushManager.subscribe(options)) as PushSubscriptionLike;
    },
  };
}

export class BrowserNotificationClient implements NotificationClient {
  readonly #getToken: () => string | null;
  readonly #fetch: typeof globalThis.fetch;
  readonly #runtime: PushRuntime;
  readonly #storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  readonly #baseUrl: string;

  constructor(options: BrowserNotificationClientOptions) {
    this.#getToken = options.getToken;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#runtime = options.runtime ?? createBrowserPushRuntime();
    this.#storage = options.storage ?? localStorage;
    this.#baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
  }

  async inspect() {
    if (!this.#runtime.supported) {
      return { status: "unsupported" as const, platform: this.#runtime.platform };
    }
    if (this.#runtime.permission() === "denied") {
      return { status: "denied" as const, platform: this.#runtime.platform };
    }
    if (this.#runtime.permission() !== "granted") {
      return { status: "disabled" as const, platform: this.#runtime.platform };
    }
    const subscription = await this.#runtime.getSubscription();
    const deviceId = this.#storage.getItem(DEVICE_ID_KEY);
    if (!subscription || !deviceId) {
      return { status: "disabled" as const, platform: this.#runtime.platform };
    }
    const state = await this.#request<ServerDeviceState>(
      `/api/lastdone/push/status?deviceId=${encodeURIComponent(deviceId)}`,
    );
    return this.#withStatus(state);
  }

  async enable(preferences = notificationDefaults(this.#runtime.platform)) {
    if (!this.#runtime.supported) {
      return { status: "unsupported" as const, platform: this.#runtime.platform };
    }
    let permission = this.#runtime.permission();
    if (permission !== "granted") {
      permission = await this.#runtime.requestPermission();
    }
    if (permission !== "granted") {
      return { status: "denied" as const, platform: this.#runtime.platform };
    }

    const config = await this.#request<{ publicKey: string }>(
      "/api/lastdone/push/config",
    );
    const subscription =
      (await this.#runtime.getSubscription()) ??
      (await this.#runtime.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeBase64Url(config.publicKey),
      }));
    const state = await this.#request<ServerDeviceState>(
      "/api/lastdone/push/subscribe",
      {
        method: "POST",
        body: JSON.stringify({
          deviceId: this.#storage.getItem(DEVICE_ID_KEY) ?? undefined,
          deviceName: this.#runtime.deviceName,
          platform: this.#runtime.platform,
          ...preferences,
          subscription: serializeSubscription(subscription),
        }),
      },
    );
    this.#storage.setItem(DEVICE_ID_KEY, state.deviceId);
    return this.#withStatus(state);
  }

  async disable() {
    if (!this.#runtime.supported) {
      return { status: "unsupported" as const, platform: this.#runtime.platform };
    }
    const deviceId = this.#storage.getItem(DEVICE_ID_KEY);
    const subscription = await this.#runtime.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
    }
    if (!deviceId) {
      return { status: "disabled" as const, platform: this.#runtime.platform };
    }
    const state = await this.#request<ServerDeviceState>(
      "/api/lastdone/push/unsubscribe",
      { method: "POST", body: JSON.stringify({ deviceId }) },
    );
    return this.#withStatus(state);
  }

  async listDevices(): Promise<NotificationDeviceState[]> {
    const states = await this.#request<ServerDeviceState[]>(
      "/api/lastdone/push/devices",
    );
    return states.map((state) => this.#withStatus(state));
  }

  async updatePreferences(
    deviceId: string,
    preferences: NotificationPreferences,
  ): Promise<NotificationDeviceState> {
    const state = await this.#request<ServerDeviceState>(
      "/api/lastdone/push/preferences",
      {
        method: "PATCH",
        body: JSON.stringify({ deviceId, ...preferences }),
      },
    );
    return this.#withStatus(state);
  }

  #withStatus(state: ServerDeviceState): NotificationDeviceState {
    return { ...state, status: state.enabled ? "enabled" : "disabled" };
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.#getToken();
    if (!token) {
      throw new Error("authentication is required for notification settings");
    }
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`notification request failed with status ${response.status}`);
    }
    return response.json() as Promise<T>;
  }
}

function serializeSubscription(subscription: PushSubscriptionLike) {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh ?? encodeKey(subscription.getKey?.("p256dh"));
  const auth = json.keys?.auth ?? encodeKey(subscription.getKey?.("auth"));
  if (!p256dh || !auth) {
    throw new Error("push subscription is missing encryption keys");
  }
  return {
    endpoint: json.endpoint ?? subscription.endpoint,
    keys: { p256dh, auth },
  };
}

function encodeKey(value: ArrayBuffer | null | undefined): string {
  if (!value) return "";
  let binary = "";
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
