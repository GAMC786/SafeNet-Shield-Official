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
      className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-center text-xs font-semibold text-primary-foreground shadow-[0_0_18px_hsl(var(--primary)/0.18)] backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <WifiOff className="h-4 w-4 shrink-0 text-primary" />
      <span>No internet connection. SafeNet will retry network features when connectivity returns.</span>
    </div>
  );
}