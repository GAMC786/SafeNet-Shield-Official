export const CLERK_ANDROID_CALLBACK_URL = "com.safenet.dns://callback";

export function getClerkSsoCallbackUrl({
  isAndroid,
  origin,
  basePath,
}: {
  isAndroid: boolean;
  origin: string;
  basePath: string;
}) {
  if (isAndroid) {
    return CLERK_ANDROID_CALLBACK_URL;
  }

  return `${origin}${basePath}/sign-in/sso-callback`;
}

export function getNativeClerkCallbackTarget({
  callbackUrl,
  origin,
  basePath,
}: {
  callbackUrl: string;
  origin: string;
  basePath: string;
}): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    return undefined;
  }

  if (
    parsed.protocol !== "com.safenet.dns:" ||
    parsed.hostname !== "callback" ||
    (parsed.pathname !== "" && parsed.pathname !== "/")
  ) {
    return undefined;
  }

  return `${origin}${basePath}/sign-in/sso-callback${parsed.search}${parsed.hash}`;
}
