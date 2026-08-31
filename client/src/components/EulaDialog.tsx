import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SAFE_NET_VPN_EULA_VERSION } from "@/hooks/use-vpn";

interface EulaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => Promise<void>;
  isAccepting?: boolean;
}

export function EulaDialog({ open, onOpenChange, onAccept, isAccepting = false }: EulaDialogProps) {
  const [hasAgreed, setHasAgreed] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setHasAgreed(false);
    }
    onOpenChange(nextOpen);
  };

  const handleAccept = async () => {
    await onAccept();
    setHasAgreed(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto bg-card border-border text-foreground sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display tracking-wider text-xl">
            SafeNet DNS VPN End User License Agreement
          </DialogTitle>
          <DialogDescription>
            Please read this agreement before enabling DNS protection. Version {SAFE_NET_VPN_EULA_VERSION}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm leading-6 text-muted-foreground">
          <section>
            <h3 className="font-semibold text-foreground">1. DNS-only protection</h3>
            <p>
              SafeNet DNS creates a local Android VPN interface to route DNS requests through the
              resolver you select in the app. It is not a full-device traffic tunnel, proxy, or
              anonymity service. Ordinary non-DNS traffic remains on your normal network connection.
            </p>
          </section>
          <section>
            <h3 className="font-semibold text-foreground">2. Resolver availability</h3>
            <p>
              Protection depends on the selected DNS resolver and your network connection. If the
              resolver is unavailable, DNS lookups may fail until you stop protection or choose another
              resolver. Applications that use their own encrypted DNS, proxy, or VPN can bypass this
              DNS-only service.
            </p>
          </section>
          <section>
            <h3 className="font-semibold text-foreground">3. Your responsibility</h3>
            <p>
              You are responsible for choosing resolvers you trust and for complying with applicable
              laws, network rules, and the terms of any third-party resolver. SafeNet DNS does not
              guarantee uninterrupted service, complete threat detection, or that every DNS request
              will be intercepted.
            </p>
          </section>
          <section>
            <h3 className="font-semibold text-foreground">4. Consent and changes</h3>
            <p>
              Android may show its own VPN permission prompt. You may stop the service at any time
              from SafeNet DNS or Android system settings. We may update this agreement for a future
              app version; an updated version must be accepted before protection can be enabled again.
            </p>
          </section>
        </div>

        <div className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 p-4">
          <Checkbox
            id="safenet-vpn-eula-agreement"
            checked={hasAgreed}
            onCheckedChange={(checked) => setHasAgreed(checked === true)}
            disabled={isAccepting}
          />
          <label htmlFor="safenet-vpn-eula-agreement" className="cursor-pointer text-sm leading-5">
            I have read and agree to this EULA, including the DNS-only scope and limitations described
            above.
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isAccepting}>
            Cancel
          </Button>
          <Button onClick={() => void handleAccept()} disabled={!hasAgreed || isAccepting}>
            {isAccepting ? "Saving agreement…" : "Accept and continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}