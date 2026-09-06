import { useEffect } from "react";

import { useData } from "../data/DataProvider";
import {
  ANDROID_NOTIFICATION_RECONCILE_EVENT,
  NOTIFICATION_PREFERENCES_CHANGED_EVENT,
  SYNC_COMPLETED_EVENT,
} from "./events";
import { reconcileAndroidNotifications } from "./androidNotificationScheduler";

const RECONCILE_DEBOUNCE_MS = 500;

export function AndroidNotificationCoordinator() {
  const { db, userId } = useData();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const reconcile = () => {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void reconcileAndroidNotifications(db, userId).catch(() => {
          // A later launch, sync, foreground, or data change retries reconciliation.
        });
      }, RECONCILE_DEBOUNCE_MS);
    };

    db.items.hook("creating", reconcile);
    db.items.hook("updating", reconcile);
    db.items.hook("deleting", reconcile);
    db.settings.hook("creating", reconcile);
    db.settings.hook("updating", reconcile);
    db.settings.hook("deleting", reconcile);
    window.addEventListener(SYNC_COMPLETED_EVENT, reconcile);
    window.addEventListener(NOTIFICATION_PREFERENCES_CHANGED_EVENT, reconcile);
    window.addEventListener(ANDROID_NOTIFICATION_RECONCILE_EVENT, reconcile);
    reconcile();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      db.items.hook("creating").unsubscribe(reconcile);
      db.items.hook("updating").unsubscribe(reconcile);
      db.items.hook("deleting").unsubscribe(reconcile);
      db.settings.hook("creating").unsubscribe(reconcile);
      db.settings.hook("updating").unsubscribe(reconcile);
      db.settings.hook("deleting").unsubscribe(reconcile);
      window.removeEventListener(SYNC_COMPLETED_EVENT, reconcile);
      window.removeEventListener(NOTIFICATION_PREFERENCES_CHANGED_EVENT, reconcile);
      window.removeEventListener(ANDROID_NOTIFICATION_RECONCILE_EVENT, reconcile);
    };
  }, [db, userId]);

  return null;
}
