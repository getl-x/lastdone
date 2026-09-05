import { describe, expect, it, vi } from "vitest";

import { createConnectivityMonitor } from "./connectivity";

describe("connectivity monitor", () => {
  it("reports online and offline transitions", () => {
    const listeners = new Map<string, EventListener>();
    const target = {
      navigator: { onLine: true },
      addEventListener: vi.fn((name: string, listener: EventListener) => {
        listeners.set(name, listener);
      }),
      removeEventListener: vi.fn(),
    };
    const monitor = createConnectivityMonitor(target);
    const changed = vi.fn();
    const unsubscribe = monitor.subscribe(changed);

    expect(monitor.getSnapshot()).toBe("online");
    target.navigator.onLine = false;
    listeners.get("offline")?.(new Event("offline"));
    expect(monitor.getSnapshot()).toBe("offline");
    expect(changed).toHaveBeenCalledOnce();

    unsubscribe();
    expect(target.removeEventListener).toHaveBeenCalledTimes(2);
  });
});
