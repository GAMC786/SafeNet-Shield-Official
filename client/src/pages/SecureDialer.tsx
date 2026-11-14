import { ArrowUpRight, Download, Github, Globe, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Button } from "@/components/ui/button";

const secureDialerLinks = {
  project: "https://secure-phone-apps.github.io/Secure-Dialer/",
  repository: "https://github.com/Secure-Phone-apps/Secure-Dialer",
  releases: "https://github.com/Secure-Phone-apps/Secure-Dialer/releases",
  obtainium:
    "https://apps.obtainium.imranr.dev/redirect?r=obtainium%3A%2F%2Fadd%2Fhttps%3A%2F%2Fgithub.com%2FSecure-Phone-apps%2FSecure-Dialer",
};

function ExternalLink({
  href,
  children,
  variant = "default",
}: {
  href: string;
  children: ReactNode;
  variant?: "default" | "outline";
}) {
  return (
    <Button asChild variant={variant}>
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
        <ArrowUpRight className="ml-2 h-4 w-4" />
      </a>
    </Button>
  );
}

export default function SecureDialer() {
  return (
    <div className="space-y-6">
      <Header
        title="Secure Dialer"
        subtitle="Independent Android dialer project"
      />

      <CyberCard className="overflow-hidden">
        <div className="grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)] md:items-center">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-primary">
              <ShieldCheck className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-wider">
                Open source · Offline-first
              </span>
            </div>
            <h2 className="text-2xl font-bold text-white sm:text-3xl">
              Secure Dialer
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Secure Dialer is a separate Android app maintained by
              Secure-Phone-apps. Its calling, contacts, and spam screening run
              on your device; it is not a SafeNet feature or an API that SafeNet
              can control.
            </p>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              GitHub blocks its repository pages from being displayed inside
              another app. Use the official project and release links below to
              review the source or install it.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <ExternalLink href={secureDialerLinks.releases}>
                <Download className="h-4 w-4" />
                Download APK
              </ExternalLink>
              <ExternalLink href={secureDialerLinks.repository} variant="outline">
                <Github className="h-4 w-4" />
                GitHub repository
              </ExternalLink>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
            <h3 className="font-semibold text-white">Official project links</h3>
            <ExternalLink href={secureDialerLinks.project} variant="outline">
              <Globe className="h-4 w-4" />
              Project website
            </ExternalLink>
            <ExternalLink href={secureDialerLinks.obtainium} variant="outline">
              <Download className="h-4 w-4" />
              Get on Obtainium
            </ExternalLink>
            <p className="text-xs leading-5 text-muted-foreground">
              Downloads and installation are handled by the project’s official
              channels. SafeNet settings and accounts are not shared
              with this app.
            </p>
          </div>
        </div>
      </CyberCard>
    </div>
  );
}
