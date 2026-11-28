import { Capacitor, registerPlugin } from "@capacitor/core";

type AuthStoragePlugin = {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
};

const nativeAuthStorage = registerPlugin<AuthStoragePlugin>("SafeNetAuthStorage");

export const isNativeAndroid = () => Capacitor.getPlatform() === "android";

export async function getNativeAuthValue(key: string) {
  if (!isNativeAndroid()) return null;
  const result = await nativeAuthStorage.get({ key });
  return result.value ?? null;
}

export async function setNativeAuthValue(key: string, value: string) {
  if (!isNativeAndroid()) throw new Error("Secure native authentication storage is only available on Android.");
  await nativeAuthStorage.set({ key, value });
}

export async function removeNativeAuthValue(key: string) {
  if (!isNativeAndroid()) return;
  await nativeAuthStorage.remove({ key });
}
