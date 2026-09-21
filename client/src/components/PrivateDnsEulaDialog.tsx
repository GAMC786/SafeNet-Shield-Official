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

type PrivateDnsEulaDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
  onCancel: () => void;
};

export function PrivateDnsEulaDialog({
  open,
  onOpenChange,
  onAccept,
  onCancel,
}: PrivateDnsEulaDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-xl" data-testid="dialog-private-dns-eula">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            SafeNet Private DNS EULA
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-2 text-left text-sm leading-6">
              <p>
                SafeNet Private DNS uses Android&apos;s system Private DNS
                setting to send DNS requests over encrypted DNS-over-TLS to the
                hostname you selected. SafeNet does not create or replace an
                Android VPN connection.
              </p>
              <p>
                Android controls the setting and only one Private DNS provider
                can be active at a time. SafeNet can open the Android settings
                screen and report whether the selected hostname is active, but
                Android requires you to confirm the provider hostname there.
              </p>
              <p>
                Apps that use their own encrypted DNS, a private proxy, or
                another VPN may bypass Android Private DNS. Resolver
                availability, filtering results, and network connectivity can
                vary by provider and network.
              </p>
              <p className="font-medium text-foreground">
                By selecting “Agree &amp; Continue,” you accept this agreement
                and authorize SafeNet to open Android Private DNS settings.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} data-testid="button-private-dns-eula-cancel">
            Not now
          </AlertDialogCancel>
          <AlertDialogAction onClick={onAccept} data-testid="button-private-dns-eula-accept">
            Agree &amp; Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}