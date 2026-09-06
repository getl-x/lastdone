export type NotificationPlatform = "web" | "ios-pwa" | "android";
export type WebPushPlatform = Exclude<NotificationPlatform, "android">;
export type NotificationStatus = "unsupported" | "denied" | "disabled" | "enabled";

export interface NotificationPreferences {
  digestEnabled: boolean;
  importantRemindersEnabled: boolean;
}

export interface NotificationDeviceState extends NotificationPreferences {
  deviceId: string;
  deviceName: string;
  platform: NotificationPlatform;
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
  platform: WebPushPlatform;
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
    | {
        status: Exclude<NotificationStatus, "enabled">;
        platform: NotificationPlatform;
      }
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
  platform: NotificationPlatform;
  enabled: boolean;
}

const DEVICE_ID_KEY = "lastdone_device_id";
const POCKETBASE_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const POCKETBASE_ID_PATTERN = /^[a-z0-9]{15}$/;

class NotificationRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class BrowserPushSetupError extends Error {}

function makeDeviceId(): string {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(15)),
    (value) => POCKETBASE_ID_ALPHABET[value % POCKETBASE_ID_ALPHABET.length],
  ).join("");
}

export function getOrCreateBrowserDeviceId(
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): string {
  const existing = storage.getItem(DEVICE_ID_KEY);
  if (existing && POCKETBASE_ID_PATTERN.test(existing)) return existing;
  const deviceId = makeDeviceId();
  storage.setItem(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

export function notificationDefaults(
  platform: NotificationPlatform,
): NotificationPreferences {
  if (platform === "ios-pwa") {
    return { digestEnabled: true, importantRemindersEnabled: true };
  }
  if (platform === "android") {
    return { digestEnabled: false, importantRemindersEnabled: true };
  }
  return { digestEnabled: false, importantRemindersEnabled: false };
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
  const platform: WebPushPlatform =
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

function browserPushFailure(cause: unknown): BrowserPushSetupError {
  const brave = typeof navigator !== "undefined" && "brave" in navigator;
  const message = brave
    ? "Brave 未能连接推送服务。请在 Brave 设置 → 隐私和安全中开启“使用 Google 服务进行推送消息”，重启浏览器后重试。"
    : "浏览器未能创建推送订阅，请确认浏览器的推送服务已开启后重试。";
  const error = new BrowserPushSetupError(message);
  if (cause instanceof Error) error.stack = `${error.stack}\nCaused by: ${cause.stack}`;
  return error;
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
    try {
      const state = await this.#request<ServerDeviceState>(
        `/api/lastdone/push/status?deviceId=${encodeURIComponent(deviceId)}`,
      );
      return this.#withStatus(state);
    } catch (cause) {
      if (cause instanceof NotificationRequestError && cause.status === 404) {
        return { status: "disabled" as const, platform: this.#runtime.platform };
      }
      throw cause;
    }
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
    let subscription: PushSubscriptionLike;
    try {
      subscription =
        (await this.#runtime.getSubscription()) ??
        (await this.#runtime.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeBase64Url(config.publicKey),
        }));
    } catch (cause) {
      throw browserPushFailure(cause);
    }
    const deviceId = getOrCreateBrowserDeviceId(this.#storage);
    const state = await this.#request<ServerDeviceState>(
      "/api/lastdone/push/subscribe",
      {
        method: "POST",
        body: JSON.stringify({
          deviceId,
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
      throw new NotificationRequestError(
        response.status,
        `notification request failed with status ${response.status}`,
      );
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
