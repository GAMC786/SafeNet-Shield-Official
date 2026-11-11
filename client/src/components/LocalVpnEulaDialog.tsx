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

type LocalVpnEulaDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
  onCancel: () => void;
};

export function LocalVpnEulaDialog({
  open,
  onOpenChange,
  onAccept,
  onCancel,
}: LocalVpnEulaDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-xl" data-testid="dialog-local-vpn-eula">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            SafeNet Local VPN EULA
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-2 text-left text-sm leading-6">
              <p>
                SafeNet creates an on-device VPN connection on this Android
                phone to capture DNS traffic and forward DNS requests through
                the resolver you selected. It does not connect to a remote VPN
                server.
              </p>
              <p>
                Android allows one active VPN at a time. Turning on SafeNet may
                disconnect or replace another VPN. You can turn SafeNet off
                from this screen at any time.
              </p>
              <p>
                DNS filtering may not apply to apps that use their own
                DNS-over-HTTPS, DNS-over-TLS, another VPN, or a private proxy.
                SafeNet filters DNS requests; it does not inspect encrypted
                HTTPS content. The selected DNS provider receives the requests
                it resolves, and its availability and filtering results depend
                on that provider and your network.
              </p>
              <p className="font-medium text-foreground">
                By selecting “Agree &amp; Continue,” you acknowledge this
                agreement and authorize SafeNet to start its local Android VPN
                for DNS protection. Android may also show its own VPN
                permission prompt.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} data-testid="button-local-vpn-eula-cancel">
            Not now
          </AlertDialogCancel>
          <AlertDialogAction onClick={onAccept} data-testid="button-local-vpn-eula-accept">
            Agree &amp; Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
