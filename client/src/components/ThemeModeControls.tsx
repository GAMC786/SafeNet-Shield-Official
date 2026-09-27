import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useColorMode } from "@/components/ColorModeProvider";
import { CyberCard } from "@/components/CyberCard";
import { Switch } from "@/components/ui/switch";

const colorModeOptions = [
  { value: "blue", label: "Blue", swatchClass: "bg-sky-500" },
  { value: "red", label: "Red", swatchClass: "bg-red-500" },
  { value: "green", label: "Green", swatchClass: "bg-green-500" },
] as const;

export function ThemeModeControls() {
  const { setTheme, theme } = useTheme();
  const { colorMode, setColorMode } = useColorMode();
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
          Choose Light or Dark Mode and select a color palette.
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

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">Color Mode</legend>
        <div className="grid grid-cols-3 gap-2">
          {colorModeOptions.map((option) => (
            <label
              key={option.value}
              className={`flex min-h-12 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring ${
                colorMode === option.value
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-background/40 text-muted-foreground hover:border-primary/60"
              }`}
            >
              <input
                type="radio"
                name="safenet-color-mode"
                value={option.value}
                checked={colorMode === option.value}
                onChange={() => setColorMode(option.value)}
                className="sr-only"
                data-testid={`color-mode-${option.value}`}
              />
              <span className={`h-3 w-3 rounded-full ${option.swatchClass}`} aria-hidden="true" />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Blue keeps the current Blue Cyberpunk GUI.
        </p>
      </fieldset>
    </CyberCard>
  );
}