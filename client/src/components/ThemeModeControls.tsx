import { useTheme } from "next-themes";
import { CyberCard } from "@/components/CyberCard";
import { Switch } from "@/components/ui/switch";

export function ThemeModeControls() {
  const { setTheme, theme } = useTheme();
  const darkModeEnabled = theme !== "light";
  const activeMode = darkModeEnabled ? "Cyberpunk Dark Mode" : "Wonderland Light Mode";
  const nextMode = darkModeEnabled ? "Wonderland Light Mode" : "Cyberpunk Dark Mode";

  return (
    <CyberCard className="space-y-4" data-testid="theme-mode-controls">
      <div>
        <h2 className="font-display text-lg tracking-wider">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose between SafeNet&apos;s Cyberpunk Dark Mode and Wonderland Light Mode.
        </p>
      </div>

      <label
        htmlFor="switch-appearance-mode"
        className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background/40 p-3 sm:max-w-lg"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground" data-testid="appearance-mode-label">
            {activeMode}
          </span>
          <span
            id="appearance-mode-description"
            className="mt-1 block text-xs text-muted-foreground"
          >
            Switch to {nextMode}
          </span>
        </span>
        <Switch
          id="switch-appearance-mode"
          checked={darkModeEnabled}
          onCheckedChange={(enabled) => setTheme(enabled ? "dark" : "light")}
          aria-label="Appearance mode"
          aria-describedby="appearance-mode-description"
          aria-valuetext={activeMode}
          data-testid="switch-appearance-mode"
        />
      </label>
    </CyberCard>
  );
}