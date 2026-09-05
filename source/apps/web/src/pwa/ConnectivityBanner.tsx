import { useConnectivity } from "./connectivity";

export function ConnectivityBanner() {
  const state = useConnectivity();
  return state === "offline" ? (
    <div className="connectivity-banner" role="status">
      当前离线，更改会保存在本机。
    </div>
  ) : null;
}
