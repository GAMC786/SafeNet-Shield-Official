import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ShieldCheck } from "lucide-react";

type DnsVpnEulaDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
  onCancel: () => void;
};

export function DnsVpnEulaDialog({
  open,
  onOpenChange,
  onAccept,
  onCancel,
}: DnsVpnEulaDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-xl" data-testid="dialog-dns-vpn-eula">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            SafeNet DNS VPN agreement
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-2 text-left text-sm leading-6">
              <p>
                SafeNet DNS VPN creates an Android VPN connection that routes
                device DNS requests through the resolver you selected. It is a
                DNS-only service and does not inspect arbitrary HTTPS content.
              </p>
              <p>
                Android permits only one VPN connection at a time. Enabling
                SafeNet DNS VPN may replace another active VPN, and stopping
                SafeNet may allow other device DNS settings or applications to
                handle requests.
              </p>
              <p>
                Resolver availability, filtering results, and network
                connectivity can vary by provider and network. You are
                responsible for choosing a resolver and for your use of the
                service. SafeNet DNS VPN is provided as available and may be
                stopped at any time from the app or Android settings.
              </p>
              <p className="font-medium text-foreground">
                By selecting “Agree & Continue,” you confirm that you
                understand and accept this agreement and authorize SafeNet to
                request Android VPN access.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} data-testid="button-dns-vpn-eula-cancel">
            Not now
          </AlertDialogCancel>
          <AlertDialogAction onClick={onAccept} data-testid="button-dns-vpn-eula-accept">
            Agree & Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}