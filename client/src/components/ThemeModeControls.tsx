import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useColorMode } from "@/components/ColorModeProvider";
import { CyberCard } from "@/components/CyberCard";
import { Switch } from "@/components/ui/switch";

const colorModeOptions = [
  { value: "red", label: "Red + White", swatchClass: "bg-red-500" },
  { value: "green", label: "Green + White", swatchClass: "bg-green-500" },
  { value: "blue", label: "Blue + White", swatchClass: "bg-blue-500" },
] as const;

export function ThemeModeControls() {
  const { setTheme, theme } = useTheme();
  const { colorMode, setColorMode } = useColorMode();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const darkModeEnabled = mounted && theme === "dark";

  return (
    <CyberCard className="space-y-4" data-testid="theme-mode-controls">
      <div>
        <h2 className="font-display text-lg tracking-wider">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Keep SafeNet&apos;s Cyberpunk GUI with a global color palette and separate Dark Mode.
        </p>
      </div>

      <label
        htmlFor="switch-dark-mode"
        className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background/40 p-3 sm:max-w-sm"
      >
        <span className="text-sm font-medium text-foreground">Dark Mode</span>
        <Switch
          id="switch-dark-mode"
          checked={darkModeEnabled}
          onCheckedChange={(enabled) => setTheme(enabled ? "dark" : "light")}
          aria-label="Dark Mode"
          data-testid="switch-dark-mode"
        />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">Color Palette</legend>
        <div className="grid grid-cols-3 gap-2">
          {colorModeOptions.map((option, index) => {
            const selected = colorMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-label={option.label}
                aria-pressed={selected}
                onClick={() => setColorMode(option.value)}
                className={`flex min-h-[4.5rem] min-w-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border px-1.5 py-2 text-xs font-semibold leading-tight transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  selected
                    ? "border-primary bg-primary/10 text-foreground shadow-[0_0_12px_hsl(var(--primary)/0.22)]"
                    : "border-border bg-background/40 text-muted-foreground hover:border-primary/60 hover:text-foreground"
                }`}
                data-testid={`color-mode-${option.value}`}
              >
                <span className="flex items-center gap-1" aria-hidden="true">
                  <span className={`h-3.5 w-3.5 rounded-sm border border-white/30 ${option.swatchClass}`} />
                  <span className="h-3.5 w-3.5 rounded-sm border border-border bg-white shadow-sm" />
                </span>
                <span className="sr-only">{index + 1}:</span>
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Palette colors apply across every SafeNet page; Blue + White keeps the original Cyberpunk colors.
        </p>
      </fieldset>
    </CyberCard>
  );
}