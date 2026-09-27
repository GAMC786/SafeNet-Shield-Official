import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { CyberCard } from "./CyberCard";
import { Switch } from "./ui/switch";

export function ThemeModeControls() {
  const { setTheme, theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const lightModeEnabled = mounted && theme === "light";

  return (
    <CyberCard className="space-y-4" data-testid="theme-mode-controls">
      <div>
        <h2 className="font-display text-lg tracking-wider">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Turn on Light Mode, or leave it off to keep SafeNet in Dark Mode.
        </p>
      </div>

      <label
        htmlFor="switch-light-mode"
        className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background/40 p-3 sm:max-w-sm"
      >
        <span className="text-sm font-medium text-foreground">Light Mode</span>
        <Switch
          id="switch-light-mode"
          checked={lightModeEnabled}
          onCheckedChange={(enabled) => setTheme(enabled ? "light" : "dark")}
          aria-label="Light Mode"
          data-testid="switch-light-mode"
        />
      </label>
    </CyberCard>
  );
}