import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const COLOR_MODES = ["blue", "red", "green"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

const COLOR_MODE_STORAGE_KEY = "safenet-color-mode";
const ColorModeContext = createContext<{
  colorMode: ColorMode;
  setColorMode: (mode: ColorMode) => void;
} | null>(null);

function isColorMode(value: string | null): value is ColorMode {
  return COLOR_MODES.some((mode) => mode === value);
}

function getInitialColorMode(): ColorMode {
  if (typeof window === "undefined") return "blue";
  const storedMode = window.localStorage.getItem(COLOR_MODE_STORAGE_KEY);
  return isColorMode(storedMode) ? storedMode : "blue";
}

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [colorMode, setColorMode] = useState<ColorMode>(getInitialColorMode);

  useLayoutEffect(() => {
    document.documentElement.dataset.colorMode = colorMode;
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, colorMode);
  }, [colorMode]);

  const value = useMemo(() => ({ colorMode, setColorMode }), [colorMode]);

  return <ColorModeContext.Provider value={value}>{children}</ColorModeContext.Provider>;
}

export function useColorMode() {
  const context = useContext(ColorModeContext);
  if (!context) {
    throw new Error("useColorMode must be used inside ColorModeProvider");
  }
  return context;
}