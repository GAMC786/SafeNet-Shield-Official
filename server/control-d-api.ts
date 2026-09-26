const CONTROL_D_API_BASE_URL = "https://api.controld.com";
const REQUEST_TIMEOUT_MS = 12_000;

export type ControlDProfile = {
  id: string;
  name: string;
  updatedAt: number | null;
};

export type ControlDDevice = {
  id: string;
  name: string;
  profileId: string | null;
  profileName: string | null;
  dotHostname: string | null;
  dohUrl: string | null;
};

export class ControlDApiError extends Error {
  constructor(readonly kind: "rejected" | "unavailable") {
    super(kind === "rejected"
      ? "Control D rejected the API credential."
      : "Control D API request failed.");
    this.name = "ControlDApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requestControlD(
  token: string,
  path: string,
  fetchImpl: typeof fetch,
  options: { method?: "GET" | "PUT"; form?: Record<string, string> } = {},
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${token}`,
  };
  const body = options.form
    ? new URLSearchParams(options.form).toString()
    : undefined;

  if (body) {
    headers["content-type"] = "application/x-www-form-urlencoded";
  }

  let response: Response;
  try {
    response = await fetchImpl(`${CONTROL_D_API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ControlDApiError("unavailable");
  }

  if (response.status === 401 || response.status === 403) {
    throw new ControlDApiError("rejected");
  }
  if (!response.ok) {
    throw new ControlDApiError("unavailable");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ControlDApiError("unavailable");
  }

  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.body)) {
    throw new ControlDApiError("unavailable");
  }
  return payload.body;
}

export async function verifyControlDToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const body = await requestControlD(token, "/users", fetchImpl);
  if (typeof body.PK !== "string" || typeof body.email !== "string") {
    throw new ControlDApiError("unavailable");
  }
}

export async function listControlDProfiles(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ControlDProfile[]> {
  const body = await requestControlD(token, "/profiles", fetchImpl);
  if (!Array.isArray(body.profiles)) {
    throw new ControlDApiError("unavailable");
  }

  return body.profiles.map((profile: unknown) => {
    if (
      !isRecord(profile)
      || typeof profile.PK !== "string"
      || typeof profile.name !== "string"
    ) {
      throw new ControlDApiError("unavailable");
    }
    return {
      id: profile.PK,
      name: profile.name,
      updatedAt: typeof profile.updated === "number" ? profile.updated : null,
    };
  });
}

function mapControlDDevice(device: unknown): ControlDDevice {
  if (
    !isRecord(device)
    || typeof device.name !== "string"
    || (typeof device.device_id !== "string" && typeof device.PK !== "string")
  ) {
    throw new ControlDApiError("unavailable");
  }

  const profile = isRecord(device.profile) ? device.profile : null;
  const resolvers = isRecord(device.resolvers) ? device.resolvers : null;
  return {
    id: typeof device.device_id === "string" ? device.device_id : String(device.PK),
    name: device.name,
    profileId: profile && typeof profile.PK === "string" ? profile.PK : null,
    profileName: profile && typeof profile.name === "string" ? profile.name : null,
    dotHostname: resolvers && typeof resolvers.dot === "string" ? resolvers.dot : null,
    dohUrl: resolvers && typeof resolvers.doh === "string" ? resolvers.doh : null,
  };
}

export async function listControlDDevices(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ControlDDevice[]> {
  const body = await requestControlD(token, "/devices", fetchImpl);
  if (!Array.isArray(body.devices)) {
    throw new ControlDApiError("unavailable");
  }
  return body.devices.map(mapControlDDevice);
}

export async function updateControlDDeviceProfile(
  token: string,
  deviceId: string,
  profileId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ControlDDevice> {
  const body = await requestControlD(
    token,
    `/devices/${encodeURIComponent(deviceId)}`,
    fetchImpl,
    { method: "PUT", form: { profile_id: profileId } },
  );
  return mapControlDDevice(body);
}