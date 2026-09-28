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
      className="mb-4 flex w-full items-start gap-3 rounded-xl border-2 border-amber-100 bg-amber-300 px-4 py-3.5 text-left text-slate-950 shadow-lg ring-1 ring-slate-950/20"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <WifiOff className="mt-0.5 h-5 w-5 shrink-0 stroke-[2.5]" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-base font-extrabold leading-tight sm:text-lg">
          No internet connection
        </span>
        <span className="mt-1 block text-sm font-medium leading-snug sm:text-base">
          SafeNet will retry network features when connectivity returns.
        </span>
      </span>
    </div>
  );
}