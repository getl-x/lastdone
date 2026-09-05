import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { AppProviders } from "./app/providers";
import { ServerSetupPage } from "./native/ServerSetupPage";
import {
  resolveRuntimeConfig,
  saveAndroidServerOrigin,
  type RuntimeConfig,
} from "./native/serverOrigin";
import "./styles/tokens.css";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("root element is missing");
}

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

void resolveRuntimeConfig().then((initialConfig) => {
  createRoot(root).render(
    <StrictMode>
      <Root initialConfig={initialConfig} />
    </StrictMode>,
  );
});
