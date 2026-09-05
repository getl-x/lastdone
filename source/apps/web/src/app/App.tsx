import { useEffect } from "react";
import { RouterProvider } from "react-router";

import { subscribeToNativeNavigation } from "../native/navigation";
import { router } from "./router";

export function App() {
  useEffect(
    () => subscribeToNativeNavigation((route) => void router.navigate(route)),
    [],
  );

  return <RouterProvider router={router} />;
}
