import { AiShieldControls } from "@/components/AiShieldControls";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { AlertTriangle } from "lucide-react";
import wordmarkImage from "@/assets/safenet-inc-logo.svg";

const terryFoxSourceUrl = "https://chatgpt.com/s/m_6a70d18637288191a25bc77259ddba66";
const terryFoxImageUrl = "https://chatgpt.com/backend-api/estuary/public_content/enc/eyJpZCI6Im1fNmE3MGQxODYzNzI4ODE5MWEyNWJjNzcyNTlkZGJhNjY6c2VkaW1lbnQ6Ly8zNzE5NDg3NjU4NDc2YmQjZmlsZV8wMDAwMDAwMGIxMDg4MWZiOTQ2ZmZmYTA1ZTQ1YmJhZCN1bmZ1cmwiLCJnaXptb19pZCI6bnVsbCwid2lkIjpudWxsLCJvaWQiOm51bGwsInNpZCI6bnVsbCwiY3MiOm51bGwsImZuIjpudWxsLCJjZCI6bnVsbCwidHMiOiIyMDcxMCIsInAiOiJweSI<SECRET>5Mi<SECRET>jQxMzQ4ZGZmOGY1MTMyYTQ2NWEzZjgzNmM1MzlhMjk1YyIsInYiOiIwIiwiY2RuIjpudWxsLCJjcCI6bnVsbCwibWEiOm51bGx9";

export default function Settings() {
  const appVersion = import.meta.env.VITE_APP_VERSION;

  return (
    <div className="space-y-6">
      <Header
        title="System Settings"
        subtitle="Configuration & Security"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="md:col-span-2">
          <AiShieldControls />
        </div>

        <div className="md:col-span-2 space-y-4 rounded border border-yellow-500/20 bg-yellow-500/5 p-4 text-sm">
          <div className="border-b border-yellow-500/10 pb-4 text-center">
            <a
              href={terryFoxSourceUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Open Terry Fox Marathon of Hope source"
            >
              <img
                src={terryFoxImageUrl}
                alt="Terry Fox Marathon of Hope"
                className="mx-auto w-full max-w-2xl rounded border border-yellow-500/20 object-cover"
              />
            </a>
            <h2 className="mt-3 font-display text-lg tracking-wider">Marathon of Hope</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              In Loving Memory of Mr. Terry Stanley Fox. (1958 – 1981)
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 text-yellow-500">
            <AlertTriangle className="w-4 h-4" />
              <span className="font-mono uppercase" data-testid="settings-version">
                SafeNet Shield DNS Server+ (Official) v{appVersion}
            </span>
          </div>
          <div className="flex flex-col items-center justify-center gap-3 border-t border-yellow-500/10 pt-4 text-center sm:flex-row sm:gap-5">
            <a
              href="mailto:Post@SafeNetInc.Ca"
              className="text-white underline-offset-4 hover:underline"
            >
              Contact Us: Post@SafeNetInc.Ca
            </a>
          </div>
          <div className="flex items-center justify-center border-t border-yellow-500/10 pt-4">
            <img
              src={wordmarkImage}
              alt="SafeNet Inc."
              className="h-12 w-[220px] object-contain"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
