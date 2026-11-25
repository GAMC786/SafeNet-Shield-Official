import { useEffect, useState } from "react";
import { useSettings, useUpdateSettings } from "@/hooks/use-settings";
import { useBlocklists, useCreateBlocklist, useDeleteBlocklist } from "@/hooks/use-blocklists";
import { useUpdateBlocklist } from "@/hooks/use-blocklists";
import { useFirewallRules, useCreateFirewallRule, useUpdateFirewallRule, useDeleteFirewallRule } from "@/hooks/use-firewall-rules";
import type { Blocklist, FirewallRule, InsertFirewallRule } from "@shared/schema";
import {
  DNS_PROVIDER_ACCESS_RULES,
  DNS_PROVIDER_PHONE_PRESETS,
  type DnsProviderAccessRule,
  type DnsResolverPreset,
} from "@shared/dns-resolvers";
import { useToast } from "@/hooks/use-toast";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Search, Pencil, Trash2, Plus, Ban, Zap, Check, X, LockKeyhole, Globe2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { Link } from "wouter";
import { useActivateDnsServer, useCreateDnsServer, useDnsServers } from "@/hooks/use-dns";
import { DnsProviderBlocklists } from "@/components/DnsProviderBlocklists";
import { useLocalVpn } from "@/hooks/use-local-vpn";
import { useFirewallConfig } from "@/hooks/use-firewall-config";
import { SafeNetVpn } from "@/hooks/use-vpn";
import { enqueueNativeCommand } from "@/lib/native-command-queue";
import { LocalVpnEulaDialog } from "@/components/LocalVpnEulaDialog";

type EditablePhoneResolverType = "none" | DnsResolverPreset["type"];
const LOCAL_VPN_EULA_VERSION = "2026-11-25-access-rules";
type FamilyDnsPresetOverride = {
  name: string;
  description: string;
  addresses: string[];
  resolverType: EditablePhoneResolverType;
  phoneResolverName: string;
  primaryAddress: string;
  secondaryAddress: string;
};

type FamilyDnsPresetDraft = Omit<FamilyDnsPresetOverride, "addresses"> & {
  addresses: string;
};

function isValidPresetIpAddress(value: string) {
  if (value.includes(":")) {
    if (!/^[0-9a-f:]+$/i.test(value) || value.includes(":::")) return false;
    const compressed = value.includes("::");
    if (value.split("::").length > 2) return false;
    const groups = value.split(":").filter(Boolean);
    return groups.length <= 8 && groups.every((group) => group.length <= 4) &&
      (compressed ? groups.length < 8 : groups.length === 8);
  }
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) =>
    /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255,
  );
}

export default function Firewall() {
  const { toast } = useToast();
  const { data: dnsServers } = useDnsServers();
  const createDnsServer = useCreateDnsServer();
  const activateDnsServer = useActivateDnsServer();
  const { data: blocklists } = useBlocklists();
  const createBlock = useCreateBlocklist();
  const updateBlock = useUpdateBlocklist();
  const deleteBlock = useDeleteBlocklist();
  
  const { data: rules } = useFirewallRules();
  const createRule = useCreateFirewallRule();
  const updateRule = useUpdateFirewallRule();
  const deleteRule = useDeleteFirewallRule();
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const localVpn = useLocalVpn();
  const firewallConfigQuery = useFirewallConfig();
  const firewallEnabled = settings?.firewallEnabled ?? false;
  const preventDnsOverrides = settings?.preventDnsOverrides ?? true;
  const [newDomain, setNewDomain] = usePersistentState("safenet-firewall-new-domain", "");
  const [newDomainAction, setNewDomainAction] = usePersistentState<"allow" | "block">(
    "safenet-firewall-new-domain-action",
    "block",
  );
  const [isRuleDialogOpen, setIsRuleDialogOpen] = usePersistentState("safenet-firewall-rule-dialog-open", false);
  const [editingRule, setEditingRule] = useState<FirewallRule | null>(null);
  const [editingRuleId, setEditingRuleId, clearEditingRuleId] = usePersistentState<number | null>(
    "safenet-firewall-editing-rule-id",
    null,
  );
  const [editingBlocklist, setEditingBlocklist] = useState<Blocklist | null>(null);
  const [editingBlocklistId, setEditingBlocklistId, clearEditingBlocklistId] = usePersistentState<number | null>(
    "safenet-firewall-editing-blocklist-id",
    null,
  );
  const [editedBlocklistContent, setEditedBlocklistContent, clearEditedBlocklistContent] = usePersistentState(
    "safenet-firewall-edited-blocklist-content",
    "",
  );
  const [editedBlocklistAction, setEditedBlocklistAction, clearEditedBlocklistAction] = usePersistentState<"allow" | "block">(
    "safenet-firewall-edited-blocklist-action",
    "block",
  );
  const [newRule, setNewRule, clearNewRule] = usePersistentState<InsertFirewallRule>("safenet-firewall-new-rule", {
    name: "",
    sourceInterface: "lan",
    sourceAddress: "Any",
    destinationInterface: "wan",
    destinationAddress: "Any",
    service: "dns",
    action: "deny" as const,
  });
  const [familyDnsPresetOverrides, setFamilyDnsPresetOverrides] =
    usePersistentState<Record<string, FamilyDnsPresetOverride>>("safenet-family-dns-preset-overrides", {});
  const [editingFamilyDnsPreset, setEditingFamilyDnsPreset] = useState<DnsProviderAccessRule | null>(null);
  const [familyDnsPresetDraft, setFamilyDnsPresetDraft] = useState<FamilyDnsPresetDraft | null>(null);
  const [familyDnsPresetError, setFamilyDnsPresetError] = useState<string | null>(null);
  const [usePhoneEulaOpen, setUsePhoneEulaOpen] = useState(false);
  const [usePhonePending, setUsePhonePending] = useState(false);
  const [acceptedEulaVersion, setAcceptedEulaVersion] = usePersistentState<string | null>(
    "safenet-local-vpn-eula-version",
    null,
  );
  const activeDns = dnsServers?.find((server) => server.isActive);
  const firewallHeaderStatus = firewallEnabled && localVpn.connected ? "rules-enabled" : "inactive";

  const getFamilyDnsPreset = (provider: DnsProviderAccessRule): DnsProviderAccessRule => {
    const override = familyDnsPresetOverrides[provider.id];
    return override
      ? { ...provider, name: override.name, description: override.description, addresses: override.addresses }
      : provider;
  };

  const getPhoneResolverPreset = (provider: DnsProviderAccessRule): DnsResolverPreset | null => {
    const override = familyDnsPresetOverrides[provider.id];
    if (!override) return DNS_PROVIDER_PHONE_PRESETS[provider.id] ?? null;
    if (override.resolverType === "none") return null;
    return {
      name: override.phoneResolverName || override.name,
      type: override.resolverType,
      ipVersion: "ipv4",
      primaryAddress: override.primaryAddress,
      secondaryAddress: override.secondaryAddress || null,
      description: override.description,
    };
  };

  const openFamilyDnsPresetEditor = (provider: DnsProviderAccessRule) => {
    const resolver = getPhoneResolverPreset(provider);
    const override = familyDnsPresetOverrides[provider.id];
    setFamilyDnsPresetDraft({
      name: override?.name ?? provider.name,
      description: override?.description ?? provider.description,
      addresses: (override?.addresses ?? provider.addresses).join("\n"),
      resolverType: override?.resolverType ?? resolver?.type ?? "none",
      phoneResolverName: override?.phoneResolverName ?? resolver?.name ?? provider.name,
      primaryAddress: override?.primaryAddress ?? resolver?.primaryAddress ?? "",
      secondaryAddress: override?.secondaryAddress ?? resolver?.secondaryAddress ?? "",
    });
    setFamilyDnsPresetError(null);
    setEditingFamilyDnsPreset(provider);
  };

  const saveFamilyDnsPreset = () => {
    if (!editingFamilyDnsPreset || !familyDnsPresetDraft) return;
    const name = familyDnsPresetDraft.name.trim();
    const addresses = familyDnsPresetDraft.addresses
      .split(/[\n,]/)
      .map((address) => address.trim())
      .filter(Boolean);
    if (!name) {
      setFamilyDnsPresetError("Enter a name for this preset.");
      return;
    }
    if (addresses.length === 0) {
      setFamilyDnsPresetError("Enter at least one resolver IP address.");
      return;
    }
    if (!addresses.every(isValidPresetIpAddress)) {
      setFamilyDnsPresetError("Enter valid IPv4 or IPv6 resolver addresses.");
      return;
    }
    if (familyDnsPresetDraft.resolverType !== "none" && !familyDnsPresetDraft.primaryAddress.trim()) {
      setFamilyDnsPresetError("Enter the phone resolver address or hostname.");
      return;
    }
    if (
      familyDnsPresetDraft.resolverType === "doh" &&
      !familyDnsPresetDraft.primaryAddress.trim().toLowerCase().startsWith("https://")
    ) {
      setFamilyDnsPresetError("DNS-over-HTTPS addresses must start with https://.");
      return;
    }

    setFamilyDnsPresetOverrides({
      ...familyDnsPresetOverrides,
      [editingFamilyDnsPreset.id]: {
        ...familyDnsPresetDraft,
        name,
        description: familyDnsPresetDraft.description.trim(),
        addresses,
        phoneResolverName: familyDnsPresetDraft.phoneResolverName.trim() || name,
        primaryAddress: familyDnsPresetDraft.primaryAddress.trim(),
        secondaryAddress: familyDnsPresetDraft.secondaryAddress.trim(),
      },
    });
    setEditingFamilyDnsPreset(null);
    setFamilyDnsPresetDraft(null);
    toast({ title: "Family DNS preset saved", description: "Changes are stored on this device and apply to future actions." });
  };

  useEffect(() => {
    if (!editingRuleId || !rules) return;
    const rule = rules.find((candidate) => candidate.id === editingRuleId);
    if (rule) {
      setEditingRule(rule);
    } else {
      setEditingRule(null);
      clearEditingRuleId();
    }
  }, [clearEditingRuleId, editingRuleId, rules]);

  useEffect(() => {
    if (!editingBlocklistId || !blocklists) return;
    const blocklist = blocklists.find((candidate) => candidate.id === editingBlocklistId);
    if (blocklist) {
      setEditingBlocklist(blocklist);
    } else {
      setEditingBlocklist(null);
      clearEditingBlocklistId();
    }
  }, [blocklists, clearEditingBlocklistId, editingBlocklistId]);

  const handleAddDomain = () => {
    if (!newDomain) return;
    const content = newDomain.trim();
    if (!content) return;
    createBlock.mutate({
      type: "domain",
      content,
      category: "custom",
      action: newDomainAction,
      isActive: true
    }, {
      onSuccess: () => {
        setNewDomain("");
        toast({
          title: "Domain rule saved",
          description: `${content} was saved as a ${newDomainAction} rule. It is enforced on this phone while SafeNet DNS-only VPN is active.`,
        });
      },
      onError: (error) => toast({
        title: "Domain rule could not be saved",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      }),
    });
  };

  const applyRulesOnPhone = async () => {
    if (!localVpn.supported) {
      toast({
        title: "Android app required",
        description: "Open SafeNet on your Android phone to use its local VPN.",
      });
      return;
    }
    if (!activeDns) {
      toast({
        title: "Choose a DNS resolver first",
        description: "Select an active resolver before using firewall rules on your phone.",
        variant: "destructive",
      });
      return;
    }
    if (acceptedEulaVersion !== LOCAL_VPN_EULA_VERSION) {
      setUsePhoneEulaOpen(true);
      return;
    }
    await startPhoneFirewall();
  };

  const startPhoneFirewall = async () => {
    if (!activeDns) return;
    setUsePhonePending(true);
    try {
      if (!firewallEnabled) {
        await updateSettings.mutateAsync({ firewallEnabled: true });
      }
      const refreshedConfig = await firewallConfigQuery.refetch();
      if (!refreshedConfig.data) {
        throw refreshedConfig.error ?? new Error("Could not load the latest firewall rules.");
      }
      await enqueueNativeCommand(() =>
        SafeNetVpn.syncFirewallConfig({ config: refreshedConfig.data! }),
      );
      const status = await localVpn.start({
        type: activeDns.type,
        primaryAddress: activeDns.primaryAddress,
        secondaryAddress: activeDns.secondaryAddress,
      });
      if (!status?.connected) {
        throw new Error(localVpn.error || "SafeNet could not start its local VPN.");
      }
      toast({
        title: "Firewall rules are active on this phone",
        description: "DNS rules and TCP/UDP port and address rules are applied. HTTPS content is not inspected.",
      });
    } catch (error) {
      toast({
        title: "Could not use firewall rules on this phone",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUsePhonePending(false);
    }
  };

  const resetRuleForm = () => {
    clearNewRule();
    clearEditingRuleId();
    setEditingRule(null);
  };

  const openCreateRuleDialog = () => {
    resetRuleForm();
    setIsRuleDialogOpen(true);
  };

  const openEditRuleDialog = (rule: FirewallRule) => {
    setEditingRule(rule);
    setEditingRuleId(rule.id);
    setNewRule({
      name: rule.name,
      sourceInterface: rule.sourceInterface,
      sourceAddress: rule.sourceAddress || "Any",
      destinationInterface: rule.destinationInterface,
      destinationAddress: rule.destinationAddress || "Any",
      service: rule.service,
      action: rule.action,
    });
    setIsRuleDialogOpen(true);
  };

  const handleSaveRule = () => {
    if (!newRule.name) {
      toast({ title: "Firewall rule name required", description: "Enter a name before saving the rule.", variant: "destructive" });
      return;
    }
    const onSuccess = () => {
      setIsRuleDialogOpen(false);
      resetRuleForm();
      toast({
        title: editingRule ? "Firewall rule updated" : "Firewall rule created",
        description: editingRule
          ? "The access rule changes were saved."
          : `${newRule.name} was saved.`,
      });
    };
    if (editingRule) {
      updateRule.mutate({ id: editingRule.id, data: newRule }, { onSuccess });
      return;
    }
    createRule.mutate(newRule, {
      onSuccess,
    });
  };

  const handleAddDnsProvider = async (provider: DnsProviderAccessRule) => {
    const existingAddresses = new Set(
      (rules || [])
        .filter((rule) => rule.service === "dns" && rule.action === "allow")
        .map((rule) => (rule.destinationAddress || "").trim().toLowerCase()),
    );
    const addressesToAdd = provider.addresses.filter(
      (address) => !existingAddresses.has(address.toLowerCase()),
    );

    if (addressesToAdd.length === 0) {
      toast({
        title: `${provider.name} is already allowed`,
        description: "This provider's resolver addresses are already saved as access rules.",
      });
      return;
    }

    try {
      await Promise.all(
        addressesToAdd.map((address) =>
          createRule.mutateAsync({
            name: `${provider.name} DNS (${address})`,
            sourceInterface: "lan",
            sourceAddress: "Any",
            destinationInterface: "wan",
            destinationAddress: address,
            service: "dns",
            action: "allow",
            isEnabled: true,
            priority: 200,
          }),
        ),
      );
      toast({
        title: `${provider.name} added to Access Rules`,
        description: `${addressesToAdd.length} DNS resolver ${addressesToAdd.length === 1 ? "address was" : "addresses were"} saved as allow rules.`,
      });
    } catch (error) {
      toast({
        title: `${provider.name} could not be added`,
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleUseFamilyDnsOnPhone = async (provider: DnsProviderAccessRule) => {
    const preset = getPhoneResolverPreset(provider);
    if (!preset) {
      toast({
        title: `${provider.name} phone resolver is not configured`,
        description: provider.id === "nextdns"
          ? "NextDNS family filtering is profile-specific. Configure its profile URL in DNS Servers or Edit this preset."
          : "Edit this preset to add a phone resolver protocol and address.",
      });
      return;
    }

    try {
      let server = (dnsServers || []).find(
        (candidate) =>
          candidate.type === preset.type &&
          candidate.primaryAddress.trim().toLowerCase() === preset.primaryAddress.toLowerCase(),
      );
      if (!server) {
        server = await createDnsServer.mutateAsync({
          name: preset.name,
          type: preset.type,
          ipVersion: preset.ipVersion,
          primaryAddress: preset.primaryAddress,
          secondaryAddress: preset.secondaryAddress,
          isCustom: false,
        });
      }
      await activateDnsServer.mutateAsync(server.id);
      if (localVpn.connected) {
        await localVpn.start({
          type: preset.type,
          primaryAddress: preset.primaryAddress,
          secondaryAddress: preset.secondaryAddress,
        });
      }
      toast({
        title: `${provider.name} selected for this phone`,
        description: localVpn.connected
          ? "The active DNS-only VPN is now using this family-safe resolver."
          : "The Dashboard DNS-only VPN will use this family-safe resolver when enabled.",
      });
    } catch (error) {
      toast({
        title: `${provider.name} could not be selected`,
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const openEditBlocklistDialog = (item: Blocklist) => {
    setEditingBlocklist(item);
    setEditingBlocklistId(item.id);
    setEditedBlocklistContent(item.content);
    setEditedBlocklistAction(item.action === "allow" ? "allow" : "block");
  };

  const closeEditBlocklistDialog = () => {
    clearEditingBlocklistId();
    clearEditedBlocklistContent();
    clearEditedBlocklistAction();
    setEditingBlocklist(null);
  };

  const handleSaveBlocklist = () => {
    const content = editedBlocklistContent.trim();
    if (!editingBlocklist || !content) return;
    updateBlock.mutate(
      {
        id: editingBlocklist.id,
        data: {
          content,
          ...(editingBlocklist.type === "domain" ? { action: editedBlocklistAction } : {}),
        },
      },
      {
        onSuccess: () => {
          const filterType = editingBlocklist.type === "keyword" ? "keyword filter" : "domain rule";
          closeEditBlocklistDialog();
          toast({
            title: `${filterType[0].toUpperCase()}${filterType.slice(1)} updated`,
            description: `${content} was saved as a ${editingBlocklist.type === "domain" ? editedBlocklistAction : "block"} rule.`,
          });
        },
        onError: (error) => toast({
          title: "Filter could not be updated",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        }),
      },
    );
  };

  const handleToggleBlocklist = (item: Blocklist) => {
    updateBlock.mutate(
      { id: item.id, data: { isActive: !item.isActive } },
      {
        onSuccess: () => toast({
          title: `${item.type === "keyword" ? "Keyword filter" : "Domain rule"} ${item.isActive ? "disabled" : "enabled"}`,
          description: `${item.content} is now ${item.isActive ? "disabled" : "enabled"}; enforcement applies while SafeNet DNS-only VPN is active.`,
        }),
        onError: (error) => toast({
          title: "Filter status could not be changed",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        }),
      },
    );
  };

  const handleDeleteRule = async (rule: FirewallRule) => {
    if (!window.confirm(`Delete the firewall rule "${rule.name}"?`)) return;
    try {
      await deleteRule.mutateAsync(rule.id);
      toast({ title: "Firewall rule deleted", description: `${rule.name} was removed.` });
    } catch (error) {
      toast({
        title: "Firewall rule could not be deleted",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleToggleRule = (rule: FirewallRule) => {
    updateRule.mutate(
      { id: rule.id, data: { isEnabled: !rule.isEnabled } },
      {
        onSuccess: () => toast({
          title: `Access rule ${rule.isEnabled ? "disabled" : "enabled"}`,
          description: `${rule.name} is now ${rule.isEnabled ? "inactive" : "active"}.`,
        }),
        onError: (error) => toast({
          title: "Access rule status could not be changed",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        }),
      },
    );
  };

  const handleDeleteBlocklist = async (item: Blocklist) => {
    if (!window.confirm(`Delete the ${item.type === "keyword" ? "keyword filter" : "domain rule"} "${item.content}"?`)) return;
    try {
      await deleteBlock.mutateAsync(item.id);
      toast({
        title: item.type === "keyword" ? "Keyword filter deleted" : "Domain rule deleted",
        description: `${item.content} was removed.`,
      });
    } catch (error) {
      toast({
        title: "Filter could not be deleted",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const domains = blocklists?.filter(b => b.type === "domain") || [];
  return (
    <div className="space-y-6">
      <LocalVpnEulaDialog
        open={usePhoneEulaOpen}
        onOpenChange={setUsePhoneEulaOpen}
        onCancel={() => setUsePhoneEulaOpen(false)}
        onAccept={() => {
          setAcceptedEulaVersion(LOCAL_VPN_EULA_VERSION);
          setUsePhoneEulaOpen(false);
          void startPhoneFirewall();
        }}
      />
      <Header 
        title="Firewall Rules" 
        subtitle="DNS & Network Packet-Filtering Rules"
        status={firewallHeaderStatus}
      />

      <CyberCard className="firewall-overview-card bg-gradient-to-r from-destructive/10 to-transparent border-destructive/20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="p-4 bg-destructive/20 rounded-full shadow-[0_0_20px_var(--destructive)]">
            <Ban className="w-8 h-8 text-destructive" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-display font-bold text-white">DNS Firewall</h2>
            <p className="text-muted-foreground">
              SafeNet applies DNS rules on this phone while its DNS-only VPN is active. It filters DNS names, not keywords or URL paths. DNS-over-HTTPS, DNS-over-TLS, and other VPNs may bypass local filtering. {blocklists?.filter((item) => item.isActive).length || 0} manual rules saved.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-sky-400/30 text-sky-200">
                {activeDns ? `Resolver: ${activeDns.name} (${activeDns.type.toUpperCase()})` : "No DNS resolver selected"}
              </Badge>
              <Link
                href="/dns"
                className="text-xs font-semibold text-primary underline-offset-4 hover:underline"
                data-testid="link-filtered-dns-provider"
              >
                Manage DNS provider
              </Link>
            </div>
            <div className="mt-4 space-y-2 rounded-md border border-white/10 bg-background/30 p-3">
              <p className="text-xs font-semibold text-white">Selected DNS provider</p>
              <p className="text-xs text-muted-foreground">
                {activeDns
                  ? `${activeDns.name} is selected as the upstream resolver. Enable SafeNet DNS-only VPN on the Dashboard to enforce phone DNS rules.`
                  : "No DNS resolver is selected. Choose one here or on DNS Servers before enabling phone protection."}
              </p>
              <p role="status" className="text-xs text-amber-200">
                Manual domain rules are saved in SafeNet. Use the provider blocklists panel below to manage native filters separately.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-center">
            <Switch
              checked={firewallEnabled}
              disabled={!settings || updateSettings.isPending}
              onCheckedChange={(checked) => updateSettings.mutate({ firewallEnabled: checked })}
                aria-label="Enable DNS filtering"
              data-testid="switch-firewall-master"
            />
          </div>
        </div>
      </CyberCard>

      <Tabs defaultValue="rules" className="w-full" orientation="vertical">
        <div className="flex flex-col md:flex-row gap-6">
          <TabsList className="flex flex-col h-auto bg-card border border-white/5 p-2 md:w-48 shrink-0">
            <TabsTrigger value="rules" className="w-full justify-start font-display tracking-wider data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              Access Rules
            </TabsTrigger>
            <TabsTrigger value="domains" className="w-full justify-start font-display tracking-wider data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              Allow/Block Domains
            </TabsTrigger>
          </TabsList>
          <div className="flex-1">

        <TabsContent value="rules" className="mt-0 space-y-4">
          <CyberCard className="border-primary/20 bg-primary/5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <h3 className="font-display font-bold text-white">Save DNS Override Policy</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Restrict direct unencrypted DNS on port 53 to SafeNet&apos;s selected upstream while the Android DNS-only VPN is active.
                  </p>
                  <p className="mt-2 text-xs text-primary/80">
                    {firewallEnabled
                      ? "The policy is enforced only while the Android DNS-only VPN is active. App-owned encrypted DNS and other VPNs may bypass it."
                      : "Turn this on to enforce saved DNS rules when the Android DNS-only VPN is active."}
                  </p>
                </div>
              </div>
              <Switch
                checked={preventDnsOverrides}
                disabled={!settings || updateSettings.isPending}
                onCheckedChange={(checked) => updateSettings.mutate({ preventDnsOverrides: checked })}
                aria-label="Save DNS Override Policy"
                data-testid="switch-prevent-dns-overrides"
              />
            </div>
          </CyberCard>

          <DnsProviderBlocklists />

          <CyberCard className="border-cyan-400/20 bg-cyan-400/5">
            <div className="flex items-start gap-3">
              <Globe2 className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
              <div className="min-w-0 flex-1">
                <h3 className="font-display font-bold text-white">Family DNS Provider Presets</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose a family-safe upstream for this phone’s DNS-only VPN, or save the resolver IPs
                  as access rules for other network equipment.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {DNS_PROVIDER_ACCESS_RULES.map((baseProvider) => {
                    const provider = getFamilyDnsPreset(baseProvider);
                    return (
                      <div
                        key={provider.id}
                        className="flex h-full flex-col rounded-lg border border-white/10 bg-background/40 p-3"
                      >
                        <div>
                          <h4 className="font-display font-bold text-white">{provider.name}</h4>
                          <p className="mt-1 text-xs text-muted-foreground">{provider.description}</p>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {provider.addresses.map((address) => (
                              <Badge
                                key={address}
                                variant="outline"
                                className="border-white/10 font-mono text-[10px] text-muted-foreground"
                              >
                                {address}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div className="mt-auto flex w-full flex-col gap-2 pt-4">
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full justify-center border-white/20"
                            onClick={() => void handleAddDnsProvider(provider)}
                            disabled={createRule.isPending}
                            data-testid={`button-add-dns-provider-${provider.id}`}
                          >
                            <Plus className="mr-1.5 h-3.5 w-3.5" />
                            Add rules
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full justify-center border-cyan-300/40 text-cyan-200 hover:bg-cyan-300/10 hover:text-cyan-100"
                            onClick={() => void handleUseFamilyDnsOnPhone(provider)}
                            disabled={createDnsServer.isPending || activateDnsServer.isPending || localVpn.busy}
                            data-testid={`button-use-phone-dns-${provider.id}`}
                          >
                            Use on phone
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="w-full justify-center"
                            onClick={() => openFamilyDnsPresetEditor(baseProvider)}
                            data-testid={`button-edit-dns-preset-${provider.id}`}
                          >
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            Edit
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </CyberCard>

          <Dialog
            open={editingFamilyDnsPreset !== null}
            onOpenChange={(open) => {
              if (!open) {
                setEditingFamilyDnsPreset(null);
                setFamilyDnsPresetDraft(null);
                setFamilyDnsPresetError(null);
              }
            }}
          >
            <DialogContent className="bg-card border-border text-foreground sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle className="font-display tracking-wider">
                  Edit {editingFamilyDnsPreset?.name ?? "Family DNS preset"}
                </DialogTitle>
              </DialogHeader>
              <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
                <p className="text-xs text-muted-foreground">
                  Changes are saved on this device and affect future actions. Existing access rules are unchanged.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="family-dns-preset-name">Preset name</Label>
                  <Input
                    id="family-dns-preset-name"
                    value={familyDnsPresetDraft?.name ?? ""}
                    onChange={(event) => setFamilyDnsPresetDraft((draft) => draft ? { ...draft, name: event.target.value } : draft)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="family-dns-preset-description">Description</Label>
                  <Textarea
                    id="family-dns-preset-description"
                    value={familyDnsPresetDraft?.description ?? ""}
                    onChange={(event) => setFamilyDnsPresetDraft((draft) => draft ? { ...draft, description: event.target.value } : draft)}
                    rows={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="family-dns-preset-addresses">Resolver IP addresses</Label>
                  <Textarea
                    id="family-dns-preset-addresses"
                    value={familyDnsPresetDraft?.addresses ?? ""}
                    onChange={(event) => setFamilyDnsPresetDraft((draft) => draft ? { ...draft, addresses: event.target.value } : draft)}
                    placeholder="One address per line"
                    rows={4}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone upstream protocol</Label>
                  <Select
                    value={familyDnsPresetDraft?.resolverType ?? "none"}
                    onValueChange={(value: EditablePhoneResolverType) =>
                      setFamilyDnsPresetDraft((draft) => draft ? { ...draft, resolverType: value } : draft)
                    }
                  >
                    <SelectTrigger className="bg-background border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      <SelectItem value="none">Not configured</SelectItem>
                      <SelectItem value="plain">Plain DNS</SelectItem>
                      <SelectItem value="dot">DNS over TLS</SelectItem>
                      <SelectItem value="doh">DNS over HTTPS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {familyDnsPresetDraft?.resolverType !== "none" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="family-dns-phone-name">Phone resolver name</Label>
                      <Input
                        id="family-dns-phone-name"
                        value={familyDnsPresetDraft?.phoneResolverName ?? ""}
                        onChange={(event) => setFamilyDnsPresetDraft((draft) => draft ? { ...draft, phoneResolverName: event.target.value } : draft)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="family-dns-phone-primary">Primary address or hostname</Label>
                      <Input
                        id="family-dns-phone-primary"
                        value={familyDnsPresetDraft?.primaryAddress ?? ""}
                        onChange={(event) => setFamilyDnsPresetDraft((draft) => draft ? { ...draft, primaryAddress: event.target.value } : draft)}
                        placeholder={familyDnsPresetDraft?.resolverType === "doh" ? "https://provider.example/dns-query" : "resolver.example"}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="family-dns-phone-secondary">Secondary address (optional)</Label>
                      <Input
                        id="family-dns-phone-secondary"
                        value={familyDnsPresetDraft?.secondaryAddress ?? ""}
                        onChange={(event) => setFamilyDnsPresetDraft((draft) => draft ? { ...draft, secondaryAddress: event.target.value } : draft)}
                      />
                    </div>
                  </>
                )}
                {familyDnsPresetError && <p role="alert" className="text-sm text-destructive">{familyDnsPresetError}</p>}
                <div className="flex flex-wrap justify-between gap-2">
                  {editingFamilyDnsPreset && familyDnsPresetOverrides[editingFamilyDnsPreset.id] && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        const next = { ...familyDnsPresetOverrides };
                        delete next[editingFamilyDnsPreset.id];
                        setFamilyDnsPresetOverrides(next);
                        setEditingFamilyDnsPreset(null);
                        setFamilyDnsPresetDraft(null);
                      }}
                    >
                      Restore defaults
                    </Button>
                  )}
                  <Button type="button" className="ml-auto" onClick={saveFamilyDnsPreset}>
                    Save preset
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Phone rules filter IP addresses and ports; SafeNet does not inspect encrypted content.
            </p>
            <div className="flex justify-end gap-2">
            <Dialog open={isRuleDialogOpen} onOpenChange={(open) => {
              setIsRuleDialogOpen(open);
              if (!open) resetRuleForm();
            }}>
              <DialogTrigger asChild>
                <Button onClick={openCreateRuleDialog} className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold">
                  <Plus className="w-4 h-4 mr-2" /> New Rule
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border text-foreground sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle className="font-display tracking-wider">
                    {editingRule ? "Edit Firewall Rule" : "Create Firewall Rule"}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label>Rule Name</Label>
                    <Input
                       data-testid="input-firewall-rule-name"
                      value={newRule.name}
                      onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                      placeholder="e.g., Block DNS"
                      className="bg-background border-border"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Source Address</Label>
                      <Input
                         data-testid="input-firewall-source-address"
                        value={newRule.sourceAddress || ""}
                        onChange={(e) => setNewRule({ ...newRule, sourceAddress: e.target.value || "Any" })}
                        placeholder="Any or CIDR"
                        className="bg-background border-border font-mono"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Destination Address</Label>
                      <Input
                        value={newRule.destinationAddress || ""}
                        onChange={(e) => setNewRule({ ...newRule, destinationAddress: e.target.value || "Any" })}
                        placeholder="Any or CIDR"
                        className="bg-background border-border font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Source Interface</Label>
                      <Select value={newRule.sourceInterface} onValueChange={(v: any) => setNewRule({ ...newRule, sourceInterface: v })}>
                        <SelectTrigger className="bg-background border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border">
                          <SelectItem value="lan">LAN</SelectItem>
                          <SelectItem value="wan">WAN</SelectItem>
                          <SelectItem value="any">Any</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Dest. Interface</Label>
                      <Select value={newRule.destinationInterface} onValueChange={(v: any) => setNewRule({ ...newRule, destinationInterface: v })}>
                        <SelectTrigger className="bg-background border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border">
                          <SelectItem value="lan">LAN</SelectItem>
                          <SelectItem value="wan">WAN</SelectItem>
                          <SelectItem value="any">Any</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Service</Label>
                      <Select value={newRule.service} onValueChange={(v: any) => setNewRule({ ...newRule, service: v })}>
                        <SelectTrigger className="bg-background border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border">
                          <SelectItem value="dns">DNS</SelectItem>
                          <SelectItem value="http">HTTP</SelectItem>
                          <SelectItem value="https">HTTPS</SelectItem>
                          <SelectItem value="all">All</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Action</Label>
                      <Select value={newRule.action} onValueChange={(v: any) => setNewRule({ ...newRule, action: v })}>
                        <SelectTrigger className="bg-background border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border">
                          <SelectItem value="allow">Allow</SelectItem>
                          <SelectItem value="deny">Deny</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Button onClick={handleSaveRule} className="w-full bg-primary hover:bg-primary/90" disabled={createRule.isPending || updateRule.isPending || !newRule.name.trim()}>
                    {createRule.isPending || updateRule.isPending ? "Saving..." : editingRule ? "Save Changes" : "Create Rule"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            <Button
              type="button"
              variant="outline"
              onClick={() => void applyRulesOnPhone()}
              disabled={!localVpn.supported || !activeDns || localVpn.busy || usePhonePending || updateSettings.isPending}
              title={!localVpn.supported ? "Available in the SafeNet Android app." : undefined}
              data-testid="button-use-firewall-rules-on-phone"
              className="border-cyan-300/40 text-cyan-200 hover:bg-cyan-300/10 hover:text-cyan-100"
            >
              {usePhonePending ? "Applying…" : "Use on Phone"}
            </Button>
            </div>
          </div>

          <div className="grid gap-3">
            {rules && rules.length > 0 ? (
              rules.map(rule => (
                <CyberCard key={rule.id} className={`p-4 ${rule.isEnabled === false ? "opacity-50" : ""}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Zap className={`w-4 h-4 ${rule.action === "deny" ? "text-destructive" : "text-primary"}`} />
                        <h4 className="font-display font-bold text-white">{rule.name}</h4>
                        <Badge variant={rule.action === "deny" ? "destructive" : "default"} className="text-xs">
                          {rule.action.toUpperCase()}
                        </Badge>
                      </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs font-mono">
                        <div className="flex flex-col">
                          <span className="text-muted-foreground">Source</span>
                          <span className="text-foreground uppercase">{rule.sourceInterface}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-muted-foreground">Destination</span>
                          <span className="text-foreground uppercase">{rule.destinationInterface}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-muted-foreground">Service</span>
                          <span className="text-foreground uppercase">{rule.service}</span>
                        </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground">Addresses</span>
                  <span className="text-foreground break-words">
                    {rule.sourceAddress || "Any"} → {rule.destinationAddress || "Any"}
                  </span>
                </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Switch
                        checked={rule.isEnabled !== false}
                        onCheckedChange={() => handleToggleRule(rule)}
                        disabled={updateRule.isPending}
                        aria-label={`${rule.name} ${rule.isEnabled === false ? "Off" : "On"}`}
                        data-testid={`switch-firewall-rule-${rule.id}`}
                        className="h-8 w-14"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditRuleDialog(rule)}
                        className="text-primary hover:text-primary hover:bg-primary/10"
                        aria-label={`Edit ${rule.name}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                       onClick={() => void handleDeleteRule(rule)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${rule.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CyberCard>
              ))
            ) : (
              <CyberCard className="text-center py-8 text-muted-foreground">
                No firewall rules configured. Create one to block DNS or other services.
              </CyberCard>
            )}
          </div>
        </TabsContent>

          <Dialog open={editingBlocklist !== null} onOpenChange={(open) => {
            if (!open) closeEditBlocklistDialog();
          }}>
            <DialogContent className="bg-card border-border text-foreground sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle className="font-display tracking-wider">
                  Edit {editingBlocklist?.type === "keyword" ? "Keyword Filter" : "Domain Rule"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                {editingBlocklist?.type === "domain" && (
                  <div className="space-y-2">
                    <Label>Action</Label>
                    <Select value={editedBlocklistAction} onValueChange={(value: "allow" | "block") => setEditedBlocklistAction(value)}>
                      <SelectTrigger className="bg-background border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        <SelectItem value="allow">Allow</SelectItem>
                        <SelectItem value="block">Block</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>{editingBlocklist?.type === "keyword" ? "Keyword" : "Domain"}</Label>
                  <Input
                    value={editedBlocklistContent}
                    onChange={(event) => setEditedBlocklistContent(event.target.value)}
                    className="bg-background border-border font-mono"
                    autoFocus
                  />
                </div>
                <Button onClick={handleSaveBlocklist} className="w-full" disabled={updateBlock.isPending || !editedBlocklistContent.trim()}>
                  {updateBlock.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

        <TabsContent value="domains" className="mt-0 space-y-4">
          <div className="flex gap-2">
            <Select value={newDomainAction} onValueChange={(v: "allow" | "block") => setNewDomainAction(v)}>
              <SelectTrigger className="w-28 bg-card border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="allow">Allow</SelectItem>
                <SelectItem value="block">Block</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Enter a domain (e.g. example.com)" 
                className="pl-10 bg-card border-border font-mono"
                value={newDomain}
                onChange={e => setNewDomain(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddDomain()}
                data-testid="input-domain-url"
              />
            </div>
            <Button 
              onClick={handleAddDomain}
              disabled={createBlock.isPending || !newDomain.trim()}
              className={newDomainAction === "block" ? "bg-destructive hover:bg-destructive/80 text-white font-bold" : "bg-primary hover:bg-primary/80 text-white font-bold"}
              data-testid="button-add-domain"
            >
              <Plus className="w-4 h-4 mr-2" /> {newDomainAction === "block" ? "Block" : "Allow"}
            </Button>
          </div>

          <div className="grid gap-2">
            {domains.map(item => (
              <div 
                key={item.id} 
                className={`flex min-w-0 items-center justify-between gap-3 p-3 rounded-lg bg-card/50 border transition-colors group ${
                    item.action === "block" ? "border-destructive/20 hover:border-destructive/40" : "border-primary/20 hover:border-primary/40"
                  } ${!item.isActive ? "opacity-50" : ""}`}
                data-testid={`url-rule-${item.id}`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {item.action === "block" ? (
                    <X className="w-4 h-4 shrink-0 text-destructive" />
                  ) : (
                    <Check className="w-4 h-4 shrink-0 text-primary" />
                  )}
                  <span
                    className="min-w-0 flex-1 break-words font-mono text-sm [overflow-wrap:anywhere]"
                    title={item.content}
                  >
                    {item.content}
                  </span>
                  <Badge 
                    variant={item.action === "block" ? "destructive" : "default"} 
                    className="shrink-0 text-[10px]"
                  >
                    {item.action?.toUpperCase() || "BLOCK"}
                  </Badge>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Switch
                    checked={item.isActive === true}
                    onCheckedChange={() => handleToggleBlocklist(item)}
                    disabled={updateBlock.isPending}
                    aria-label={`${item.content} ${item.isActive ? "On" : "Off"}`}
                    data-testid={`switch-toggle-rule-${item.id}`}
                    className="h-8 w-14"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-primary hover:text-primary hover:bg-primary/10"
                    onClick={() => openEditBlocklistDialog(item)}
                    aria-label={`Edit ${item.content}`}
                    data-testid={`button-edit-rule-${item.id}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void handleDeleteBlocklist(item)}
                    aria-label={`Delete ${item.content}`}
                    data-testid={`button-delete-rule-${item.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
            {domains.length === 0 && (
              <p className="text-center py-8 text-muted-foreground font-mono text-sm">No domain rules saved yet.</p>
            )}
          </div>
        </TabsContent>

          </div>
        </div>
      </Tabs>
    </div>
  );
}
