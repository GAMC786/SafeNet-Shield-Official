import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function NetworkStatusBanner() {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (online) {
    return null;
  }

  return (
    <div
      className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 border-b border-amber-400/30 bg-amber-950/95 px-4 py-2 text-center text-xs font-semibold text-amber-100 shadow-lg"
      role="status"
      aria-live="polite"
    >
      <WifiOff className="h-4 w-4 shrink-0 text-amber-300" />
      <span>No internet connection. SafeNet will retry network features when connectivity returns.</span>
    </div>
  );
}