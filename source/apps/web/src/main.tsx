import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { AppProviders } from "./app/providers";
import { bootstrapNativeRuntime } from "./native/bootstrap";
import { ServerSetupPage, StartupErrorPage } from "./native/ServerSetupPage";
import {
  resolveRuntimeConfig,
  saveAndroidServerOrigin,
  type RuntimeConfig,
} from "./native/serverOrigin";
import "./styles/tokens.css";
import "./styles/global.css";

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`${id} element is missing`);
  }
  return element;
}

const root = requiredElement("root");

function Root({ initialConfig }: { initialConfig: RuntimeConfig | null }) {
  const [runtimeConfig, setRuntimeConfig] = useState(initialConfig);

  if (!runtimeConfig) {
    return (
      <ServerSetupPage
        onSave={async (serverOrigin) => {
          setRuntimeConfig(await saveAndroidServerOrigin(serverOrigin));
        }}
      />
    );
  }

  return (
    <AppProviders runtimeConfig={runtimeConfig}>
      <App />
    </AppProviders>
  );
}

async function start() {
  await bootstrapNativeRuntime().catch(() => {
    // Native listeners will be retried on the next application launch.
  });
  let initialConfig: RuntimeConfig | null;
  try {
    initialConfig = await resolveRuntimeConfig();
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "请检查应用配置后重新启动。";
    createRoot(root).render(
      <StrictMode>
        <StartupErrorPage message={message} />
      </StrictMode>,
    );
    return;
  }
  createRoot(root).render(
    <StrictMode>
      <Root initialConfig={initialConfig} />
    </StrictMode>,
  );
}

void start();
