import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { useTheme } from "next-themes";
import { SafeNetVpn } from "@/hooks/use-vpn";
import { enqueueNativeCommand } from "@/lib/native-command-queue";

export function NativeStatusBarThemeSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android" || !resolvedTheme) return;
    void enqueueNativeCommand(() =>
      SafeNetVpn.setSystemBarAppearance({
        theme: resolvedTheme === "light" ? "light" : "dark",
      })
    ).catch(() => undefined);
  }, [resolvedTheme]);

  return null;
}
