import { App } from "@capacitor/app";
import { useEffect, useState } from "react";

import { useRuntimeConfig } from "../native/serverOrigin";

interface HealthPayload {
  status?: string;
  appVersion?: string;
  databaseVersion?: string;
}

interface VersionState {
  client: string;
  server: string;
  database: string;
}

export function VersionInfo() {
  const runtime = useRuntimeConfig();
  const [versions, setVersions] = useState<VersionState>({
    client: import.meta.env.VITE_LASTDONE_VERSION || "dev",
    server: "不可用",
    database: "不可用",
  });

  useEffect(() => {
    let active = true;
    const load = async () => {
      const client = runtime.isAndroid
        ? await App.getInfo()
            .then((info) => info.version)
            .catch(() => import.meta.env.VITE_LASTDONE_VERSION || "dev")
        : import.meta.env.VITE_LASTDONE_VERSION || "dev";
      const health = await fetch(`${runtime.serverOrigin}/api/lastdone/health`, {
        headers: { Accept: "application/json" },
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("health request failed");
          return (await response.json()) as HealthPayload;
        })
        .catch(() => null);
      if (!active) return;
      setVersions({
        client,
        server: health?.appVersion || "不可用",
        database: health?.databaseVersion || "不可用",
      });
    };
    void load();
    return () => {
      active = false;
    };
  }, [runtime.isAndroid, runtime.serverOrigin]);

  return (
    <footer className="version-info">
      LastDone {versions.client} · Server {versions.server} · Database{" "}
      {versions.database}
    </footer>
  );
}
