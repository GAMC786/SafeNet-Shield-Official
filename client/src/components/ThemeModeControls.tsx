import { useTheme } from "next-themes";
import { CyberCard } from "@/components/CyberCard";
import { Switch } from "@/components/ui/switch";

export function ThemeModeControls() {
  const { setTheme, theme } = useTheme();
  const darkModeEnabled = theme !== "light";
  const lightModeEnabled = theme === "light";

  return (
    <CyberCard className="space-y-4" data-testid="theme-mode-controls">
      <div>
        <h2 className="font-display text-lg tracking-wider">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose between SafeNet&apos;s Cyberpunk Dark Mode and Wonderland Light Mode.
        </p>
      </div>

      <div role="group" aria-label="Appearance modes" className="space-y-2 sm:max-w-lg">
        <label
          htmlFor="switch-appearance-dark"
          className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background/40 p-3"
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">
              Cyberpunk Dark Mode
            </span>
            <span
              id="appearance-dark-description"
              className="mt-1 block text-xs text-muted-foreground"
            >
              SafeNet&apos;s original Cyberpunk appearance.
            </span>
          </span>
          <Switch
            id="switch-appearance-dark"
            checked={darkModeEnabled}
            onCheckedChange={(enabled) => setTheme(enabled ? "dark" : "light")}
            aria-label="Cyberpunk Dark Mode"
            aria-describedby="appearance-dark-description"
            data-testid="switch-appearance-dark"
          />
        </label>

        <label
          htmlFor="switch-appearance-light"
          className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background/40 p-3"
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">
              Wonderland Light Mode
            </span>
            <span
              id="appearance-light-description"
              className="mt-1 block text-xs text-muted-foreground"
            >
              Use the Wonderland color palette.
            </span>
          </span>
          <Switch
            id="switch-appearance-light"
            checked={lightModeEnabled}
            onCheckedChange={(enabled) => setTheme(enabled ? "light" : "dark")}
            aria-label="Wonderland Light Mode"
            aria-describedby="appearance-light-description"
            data-testid="switch-appearance-light"
          />
        </label>
      </div>
    </CyberCard>
  );
}