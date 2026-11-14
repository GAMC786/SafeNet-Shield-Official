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

const openCallShieldLinks = {
  repository: "https://github.com/jhonsu01/OpenCallShield",
  releases: "https://github.com/jhonsu01/OpenCallShield/releases/latest",
  playStore: "https://play.google.com/store/apps/details?id=com.jhonsu01.opencallshield",
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
        title="Dialer/Spam Blocker"
        subtitle="Dialer projects and caller protection"
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <CyberCard className="overflow-hidden">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-primary">
              <ShieldCheck className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-wider">
                Offline-first dialer
              </span>
            </div>
            <h2 className="text-xl font-bold text-white sm:text-2xl">Secure Dialer</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              A separate Android dialer maintained by Secure-Phone-apps. Its
              calling, contacts, and spam screening run on your device; SafeNet
              cannot control its features.
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              GitHub blocks its repository pages from being displayed inside
              another app. Use the official links to review or install it.
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
              <ExternalLink href={secureDialerLinks.project} variant="outline">
                <Globe className="h-4 w-4" />
                Project website
              </ExternalLink>
              <ExternalLink href={secureDialerLinks.obtainium} variant="outline">
                <Download className="h-4 w-4" />
                Get on Obtainium
              </ExternalLink>
            </div>
          </div>
        </CyberCard>

        <CyberCard className="overflow-hidden">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-primary">
              <ShieldCheck className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-wider">
                Android spam call blocker
              </span>
            </div>
            <h2 className="text-xl font-bold text-white sm:text-2xl">OpenCallShield</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              SafeNet’s live caller checks now use OpenCallShield’s public spam
              number list. If that feed is unavailable, SafeNet uses its verified
              offline backup list.
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              OpenCallShield is also a separate Android app. It is not embedded
              in SafeNet; its Play Store and source links are below.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <ExternalLink href={openCallShieldLinks.playStore}>
                <Download className="h-4 w-4" />
                Google Play
              </ExternalLink>
              <ExternalLink href={openCallShieldLinks.releases} variant="outline">
                <Download className="h-4 w-4" />
                Latest APK
              </ExternalLink>
              <ExternalLink href={openCallShieldLinks.repository} variant="outline">
                <Github className="h-4 w-4" />
                OpenCallShield source
              </ExternalLink>
            </div>
          </div>
        </CyberCard>
      </div>
    </div>
  );
}
