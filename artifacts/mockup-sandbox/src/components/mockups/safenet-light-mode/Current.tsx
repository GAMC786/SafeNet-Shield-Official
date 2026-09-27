import "./_group.css";
import { ThemeProvider } from "next-themes";
import SettingsPage from "./_shared/SettingsPage";
import { SystemNavigation, Navigation } from "./_shared/Navigation";

export function Current() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="mockup-safenet-current">
      <div className="relative min-h-screen bg-background text-foreground">
        <div className="safenet-background-grid" aria-hidden="true" />
        <SystemNavigation />
        <Navigation />
        <main className="relative mx-auto w-full max-w-7xl space-y-6 p-4 pb-24 pt-24 sm:p-6 sm:pb-24 sm:pt-28 lg:p-8 lg:pt-28">
          <SettingsPage />
        </main>
      </div>
    </ThemeProvider>
  );
}