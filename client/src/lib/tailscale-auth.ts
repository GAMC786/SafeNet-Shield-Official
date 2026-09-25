export interface TailscaleAuthStatus {
  backendState: string;
  connected: boolean;
  loginRequired: boolean;
  authUrl?: string | null;
  error?: string | null;
}

export interface AuthUrlWaitOptions {
  attempts?: number;
  intervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function shouldWaitForAuthUrl(status: TailscaleAuthStatus) {
  if (status.authUrl || status.connected || status.error) return false;
  const state = status.backendState.toLowerCase();
  return status.loginRequired || state === "starting" || state === "stopped";
}

export async function waitForTailscaleAuthUrl<TStatus extends TailscaleAuthStatus>(
  initialStatus: TStatus,
  readStatus: () => Promise<TStatus>,
  {
    attempts = 10,
    intervalMs = 500,
    sleep = (milliseconds) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  }: AuthUrlWaitOptions = {},
): Promise<TStatus> {
  let status = initialStatus;
  for (let attempt = 0; attempt < attempts && shouldWaitForAuthUrl(status); attempt++) {
    await sleep(intervalMs);
    status = await readStatus();
  }
  return status;
}