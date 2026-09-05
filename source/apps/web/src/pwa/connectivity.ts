import { useSyncExternalStore } from "react";

export type ConnectivityState = "online" | "offline";

interface ConnectivityTarget {
  navigator: { onLine: boolean };
  addEventListener(name: "online" | "offline", listener: EventListener): void;
  removeEventListener(name: "online" | "offline", listener: EventListener): void;
}

export function createConnectivityMonitor(target: ConnectivityTarget) {
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const onlineListener: EventListener = emit;
  const offlineListener: EventListener = emit;
  let listening = false;

  return {
    getSnapshot(): ConnectivityState {
      return target.navigator.onLine ? "online" : "offline";
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      if (!listening) {
        target.addEventListener("online", onlineListener);
        target.addEventListener("offline", offlineListener);
        listening = true;
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && listening) {
          target.removeEventListener("online", onlineListener);
          target.removeEventListener("offline", offlineListener);
          listening = false;
        }
      };
    },
  };
}

const browserMonitor =
  typeof window === "undefined"
    ? null
    : createConnectivityMonitor({
        navigator: window.navigator,
        addEventListener: (name, listener) => window.addEventListener(name, listener),
        removeEventListener: (name, listener) =>
          window.removeEventListener(name, listener),
      });

export function useConnectivity(): ConnectivityState {
  return useSyncExternalStore(
    browserMonitor?.subscribe ?? (() => () => undefined),
    browserMonitor?.getSnapshot ?? (() => "online"),
    () => "online",
  );
}
