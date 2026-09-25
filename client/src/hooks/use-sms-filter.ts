import { useCallback, useEffect, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";

export type SmsFilterStatus = {
  supported: boolean;
  roleAvailable: boolean;
  roleHeld: boolean;
  permissionsGranted: boolean;
  enabled: boolean;
  quarantineCount: number;
  mmsSupported: boolean;
  message: string;
};

export type LocalSmsMessage = {
  id: string | number;
  sender: string;
  body: string;
  receivedAt: number;
  reason?: string;
};

type SmsFilterPlugin = {
  getStatus(): Promise<SmsFilterStatus>;
  requestDefaultSmsApp(): Promise<SmsFilterStatus>;
  requestSmsPermissions(): Promise<SmsFilterStatus>;
  setEnabled(options: { enabled: boolean }): Promise<SmsFilterStatus>;
  syncRules(options: {
    keywords: string[];
    regexes: string[];
    allowedSenders: string[];
  }): Promise<SmsFilterStatus>;
  getQuarantinedMessages(): Promise<{ messages: LocalSmsMessage[] }>;
  getRecentMessages(): Promise<{ messages: LocalSmsMessage[] }>;
  restoreQuarantinedMessage(options: { id: string }): Promise<SmsFilterStatus>;
  deleteQuarantinedMessage(options: { id: string }): Promise<SmsFilterStatus>;
  sendMessage(options: { recipient: string; body: string }): Promise<{ accepted: boolean }>;
};

const SmsFilterNative = registerPlugin<SmsFilterPlugin>("SafeNetSmsFilter");

export function useSmsFilter() {
  const supported = Capacitor.getPlatform() === "android";
  const [status, setStatus] = useState<SmsFilterStatus | null>(null);
  const [quarantinedMessages, setQuarantinedMessages] = useState<LocalSmsMessage[]>([]);
  const [recentMessages, setRecentMessages] = useState<LocalSmsMessage[]>([]);
  const [isBusy, setIsBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supported) return null;
    try {
      const nextStatus = await SmsFilterNative.getStatus();
      setStatus(nextStatus);
      const quarantined = await SmsFilterNative.getQuarantinedMessages();
      setQuarantinedMessages(quarantined.messages ?? []);
      return nextStatus;
    } catch {
      const unavailable: SmsFilterStatus = {
        supported: true,
        roleAvailable: false,
        roleHeld: false,
        permissionsGranted: false,
        enabled: false,
        quarantineCount: 0,
        mmsSupported: false,
        message: "Android SMS filter status is unavailable.",
      };
      setStatus(unavailable);
      setRecentMessages([]);
      return unavailable;
    }
  }, [supported]);

  const refreshRecentMessages = useCallback(async () => {
    if (!supported) return [];
    try {
      const recent = await SmsFilterNative.getRecentMessages();
      const messages = recent.messages ?? [];
      setRecentMessages(messages);
      return messages;
    } catch (error) {
      setRecentMessages([]);
      throw error;
    }
  }, [supported]);

  useEffect(() => {
    if (!status?.roleHeld || !status.permissionsGranted) {
      setRecentMessages([]);
      return;
    }
    void refreshRecentMessages().catch(() => undefined);
  }, [refreshRecentMessages, status?.permissionsGranted, status?.roleHeld]);

  useEffect(() => {
    if (!supported) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(interval);
  }, [refresh, supported]);

  const requestDefaultSmsApp = useCallback(async () => {
    setIsBusy(true);
    try {
      const nextStatus = await SmsFilterNative.requestDefaultSmsApp();
      setStatus(nextStatus);
      return nextStatus;
    } finally {
      setIsBusy(false);
    }
  }, []);

  const requestSmsPermissions = useCallback(async () => {
    setIsBusy(true);
    try {
      const nextStatus = await SmsFilterNative.requestSmsPermissions();
      setStatus(nextStatus);
      return nextStatus;
    } finally {
      setIsBusy(false);
    }
  }, []);

  const setEnabled = useCallback(async (enabled: boolean) => {
    setIsBusy(true);
    try {
      const nextStatus = await SmsFilterNative.setEnabled({ enabled });
      setStatus(nextStatus);
      return nextStatus;
    } finally {
      setIsBusy(false);
    }
  }, []);

  const syncRules = useCallback(async (options: {
    keywords: string[];
    regexes: string[];
    allowedSenders: string[];
  }) => SmsFilterNative.syncRules(options), []);

  const restoreMessage = useCallback(async (id: string) => {
    setIsBusy(true);
    try {
      const nextStatus = await SmsFilterNative.restoreQuarantinedMessage({ id });
      setStatus(nextStatus);
      await refresh();
      await refreshRecentMessages();
    } finally {
      setIsBusy(false);
    }
  }, [refresh, refreshRecentMessages]);

  const deleteMessage = useCallback(async (id: string) => {
    setIsBusy(true);
    try {
      const nextStatus = await SmsFilterNative.deleteQuarantinedMessage({ id });
      setStatus(nextStatus);
      await refresh();
    } finally {
      setIsBusy(false);
    }
  }, [refresh]);

  const sendMessage = useCallback(async (recipient: string, body: string) => {
    setIsBusy(true);
    try {
      return await SmsFilterNative.sendMessage({ recipient, body });
    } finally {
      setIsBusy(false);
    }
  }, []);

  return {
    supported,
    status,
    isBusy,
    quarantinedMessages,
    recentMessages,
    refresh,
    refreshRecentMessages,
    requestDefaultSmsApp,
    requestSmsPermissions,
    setEnabled,
    syncRules,
    restoreMessage,
    deleteMessage,
    sendMessage,
  };
}