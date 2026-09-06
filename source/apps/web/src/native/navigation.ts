const NAVIGATE_EVENT = "lastdone:native-navigate";
let pendingRoute: string | null = null;

export function normalizeAppRoute(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/")) {
    return null;
  }

  try {
    const parsed = new URL(value, "https://lastdone.invalid");
    if (parsed.origin !== "https://lastdone.invalid") {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function requestNativeNavigation(value: unknown): void {
  const route = normalizeAppRoute(value);
  if (!route) return;

  pendingRoute = route;
  window.dispatchEvent(new CustomEvent<string>(NAVIGATE_EVENT, { detail: route }));
}

export function subscribeToNativeNavigation(
  listener: (route: string) => void,
): () => void {
  const handle = (event: Event) => {
    const route = normalizeAppRoute((event as CustomEvent<unknown>).detail);
    if (!route) return;
    pendingRoute = null;
    listener(route);
  };
  window.addEventListener(NAVIGATE_EVENT, handle);

  if (pendingRoute) {
    const route = pendingRoute;
    pendingRoute = null;
    queueMicrotask(() => listener(route));
  }

  return () => window.removeEventListener(NAVIGATE_EVENT, handle);
}
