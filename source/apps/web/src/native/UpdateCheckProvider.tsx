import { App } from "@capacitor/app";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import {
  checkForUpdate,
  isComparableVersion,
  type UpdateCheckResult,
} from "./updateChecker";

export type UpdateCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date"; currentVersion: string }
  | { status: "update-available"; result: UpdateCheckResult }
  | { status: "unsupported"; currentVersion: string }
  | { status: "error"; message: string };

interface UpdateCheckContextValue {
  state: UpdateCheckState;
  check: () => Promise<void>;
}

const UpdateCheckContext = createContext<UpdateCheckContextValue | null>(null);

async function readClientVersion(): Promise<string> {
  const info = await App.getInfo().catch(() => null);

  return info?.version || import.meta.env.VITE_LASTDONE_VERSION || "dev";
}

export function UpdateCheckProvider({
  children,
  isAndroid,
}: PropsWithChildren<{ isAndroid: boolean }>) {
  const [state, setState] = useState<UpdateCheckState>({ status: "idle" });
  const runningRef = useRef(false);

  const check = useCallback(async () => {
    if (runningRef.current) {
      return;
    }
    runningRef.current = true;
    setState({ status: "checking" });

    try {
      const currentVersion = await readClientVersion();
      if (!isComparableVersion(currentVersion)) {
        setState({ status: "unsupported", currentVersion });
        return;
      }
      const result = await checkForUpdate(currentVersion);
      setState(
        result.updateAvailable
          ? { status: "update-available", result }
          : { status: "up-to-date", currentVersion: result.currentVersion },
      );
    } catch (cause) {
      setState({
        status: "error",
        message: cause instanceof Error ? cause.message : "未知错误",
      });
    } finally {
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isAndroid) {
      return;
    }
    void check();
  }, [check, isAndroid]);

  const value = useMemo(() => ({ check, state }), [check, state]);
  return (
    <UpdateCheckContext.Provider value={value}>{children}</UpdateCheckContext.Provider>
  );
}

export function useUpdateCheck(): UpdateCheckContextValue {
  const value = useContext(UpdateCheckContext);
  if (!value) {
    throw new Error("useUpdateCheck must be used inside UpdateCheckProvider");
  }
  return value;
}
