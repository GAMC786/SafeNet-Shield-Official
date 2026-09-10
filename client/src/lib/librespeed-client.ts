/*
 * LibreSpeed-compatible browser measurement client.
 *
 * The transport contract follows the open-source LibreSpeed project:
 * https://github.com/librespeed/speedtest
 *
 * SafeNet keeps its own presentation layer and same-origin endpoints so the
 * existing Measure Your Network UI can consume the normal LibreSpeed status
 * stream without embedding a second application.
 */

export interface LibreSpeedStatus {
  testState: -1 | 0 | 1 | 2 | 3 | 4 | 5;
  dlStatus: string;
  ulStatus: string;
  pingStatus: string;
  jitterStatus: string;
  clientIp: string;
  dlProgress: number;
  ulProgress: number;
  pingProgress: number;
  packetLoss: number;
}

export interface LibreSpeedClientOptions {
  baseUrl: string;
  downloadPath: string;
  uploadPath: string;
  pingPath: string;
  getIpPath: string;
  downloadSeconds?: number;
  uploadSeconds?: number;
  pingCount?: number;
  downloadStreams?: number;
  uploadStreams?: number;
  uploadBytes?: number;
  requestTimeoutMs?: number;
  onUpdate?: (status: LibreSpeedStatus) => void;
  onEnd?: (aborted: boolean) => void;
  onError?: (error: Error) => void;
}

const EMPTY_STATUS: LibreSpeedStatus = {
  testState: -1,
  dlStatus: "",
  ulStatus: "",
  pingStatus: "",
  jitterStatus: "",
  clientIp: "",
  dlProgress: 0,
  ulProgress: 0,
  pingProgress: 0,
  packetLoss: 0,
};

function withRandomQuery(url: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}r=${Math.random().toString(36).slice(2)}`;
}

function parseStatus(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "";
}

export class LibreSpeedClient {
  private readonly options: Required<Omit<LibreSpeedClientOptions, "onUpdate" | "onEnd" | "onError">> &
    Pick<LibreSpeedClientOptions, "onUpdate" | "onEnd" | "onError">;
  private status: LibreSpeedStatus = { ...EMPTY_STATUS };
  private activeRequests = new Set<XMLHttpRequest>();
  private timers = new Set<number>();
  private aborted = false;
  private ended = false;
  private cancelCurrentTransfer: (() => void) | null = null;

  constructor(options: LibreSpeedClientOptions) {
    this.options = {
      ...options,
      downloadSeconds: options.downloadSeconds ?? 8,
      uploadSeconds: options.uploadSeconds ?? 8,
      pingCount: options.pingCount ?? 10,
      downloadStreams: options.downloadStreams ?? 5,
      uploadStreams: options.uploadStreams ?? 3,
      uploadBytes: options.uploadBytes ?? 2_000_000,
      requestTimeoutMs: options.requestTimeoutMs ?? 10_000,
    };
  }

  start() {
    void this.run();
  }

  abort() {
    if (this.ended) return;
    this.aborted = true;
    this.activeRequests.forEach((request) => request.abort());
    this.activeRequests.clear();
    this.cancelCurrentTransfer?.();
    this.cancelCurrentTransfer = null;
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers.clear();
  }

  private emit(patch: Partial<LibreSpeedStatus>) {
    this.status = { ...this.status, ...patch };
    this.options.onUpdate?.({ ...this.status });
  }

  private finish(aborted: boolean) {
    if (this.ended) return;
    this.ended = true;
    this.options.onEnd?.(aborted);
  }

  private request(method: "GET" | "POST", url: string, body?: Blob) {
    return new Promise<{ text: string; bytes: number }>((resolve, reject) => {
      const request = new XMLHttpRequest();
      this.activeRequests.add(request);
      request.open(method, withRandomQuery(url), true);
      request.timeout = this.options.requestTimeoutMs;
      request.setRequestHeader("Cache-Control", "no-cache");
      if (method === "POST") request.setRequestHeader("Content-Encoding", "identity");
      request.onload = () => {
        this.activeRequests.delete(request);
        if (request.status < 200 || request.status >= 300) {
          reject(new Error(`LibreSpeed endpoint returned HTTP ${request.status}.`));
          return;
        }
        resolve({ text: request.responseText, bytes: body?.size ?? 0 });
      };
      request.onerror = () => {
        this.activeRequests.delete(request);
        reject(new Error("The LibreSpeed measurement request failed."));
      };
      request.ontimeout = () => {
        this.activeRequests.delete(request);
        reject(new Error(`LibreSpeed endpoint timed out after ${this.options.requestTimeoutMs}ms.`));
      };
      request.onabort = () => {
        this.activeRequests.delete(request);
        reject(new Error("The LibreSpeed measurement was aborted."));
      };
      request.send(body);
    });
  }

  private async run() {
    try {
      this.emit({ ...EMPTY_STATUS, testState: 0 });
      const ipResponse = await this.request("GET", this.url(this.options.getIpPath));
      if (this.aborted) return this.finish(true);
      try {
        const payload = JSON.parse(ipResponse.text) as { processedString?: string };
        this.emit({ clientIp: payload.processedString ?? "" });
      } catch {
        this.emit({ clientIp: ipResponse.text.trim() });
      }

      const ping = await this.runPing();
      if (this.aborted) return this.finish(true);
      this.emit({
        testState: 2,
        pingStatus: parseStatus(ping.average),
        jitterStatus: parseStatus(ping.jitter),
        pingProgress: 1,
        packetLoss: ping.packetLoss,
      });

      const download = await this.runTransfer("download");
      if (this.aborted) return this.finish(true);
      this.emit({ testState: 1, dlStatus: parseStatus(download.speed), dlProgress: 1 });

      const upload = await this.runTransfer("upload");
      if (this.aborted) return this.finish(true);
      this.emit({
        testState: 3,
        ulStatus: parseStatus(upload.speed),
        ulProgress: 1,
      });
      this.emit({ testState: 4 });
      this.finish(false);
    } catch (error) {
      if (this.aborted) {
        this.finish(true);
        return;
      }
      const normalized = error instanceof Error ? error : new Error("The LibreSpeed test failed.");
      this.options.onError?.(normalized);
      this.finish(true);
    }
  }

  private async runPing() {
    this.emit({ testState: 2, pingProgress: 0 });
    const samples: number[] = [];
    let failedSamples = 0;
    const count = this.options.pingCount;
    for (let index = 0; index < count; index += 1) {
      if (this.aborted) throw new Error("The LibreSpeed measurement was aborted.");
      const startedAt = performance.now();
      try {
        await this.request("GET", this.url(this.options.pingPath));
        samples.push(Math.max(1, performance.now() - startedAt));
      } catch (error) {
        if (this.aborted) throw error;
        failedSamples += 1;
      } finally {
        this.emit({
          pingProgress: (index + 1) / count,
          packetLoss: ((failedSamples / (index + 1)) * 100),
        });
      }
    }
    if (!samples.length) throw new Error("LibreSpeed did not receive a latency sample.");
    // LibreSpeed reports the best post-warmup RTT and a weighted jitter
    // signal rather than averaging slow outliers into the connection latency.
    const measuredSamples = samples.length > 1 ? samples.slice(1) : samples;
    const average = Math.min(...measuredSamples);
    let jitter = 0;
    for (let index = 1; index < measuredSamples.length; index += 1) {
      const instantaneous = Math.abs(measuredSamples[index] - measuredSamples[index - 1]);
      jitter = index === 1
        ? instantaneous
        : instantaneous > jitter
          ? jitter * 0.3 + instantaneous * 0.7
          : jitter * 0.8 + instantaneous * 0.2;
    }
    return { average, jitter, packetLoss: (failedSamples / count) * 100 };
  }

  private runTransfer(direction: "download" | "upload") {
    const duration = (direction === "download" ? this.options.downloadSeconds : this.options.uploadSeconds) * 1000;
    const graceDuration = direction === "download" ? 1500 : 3000;
    const totalDuration = duration + graceDuration;
    const streams = direction === "download" ? this.options.downloadStreams : this.options.uploadStreams;
    const startedAt = performance.now();
    let measuredBytes = 0;
    let measuredStartedAt = 0;
    let measurementStarted = false;
    let finished = false;
    let timer: number | null = null;
    const uploadPayload = new Uint8Array(this.options.uploadBytes);
    if (direction === "upload") uploadPayload.fill(83);
    const payload = direction === "upload" ? new Blob([uploadPayload], { type: "application/octet-stream" }) : undefined;
    const path = this.url(direction === "download" ? this.options.downloadPath : this.options.uploadPath);

    return new Promise<{ speed: number }>((resolve, reject) => {
      const complete = () => {
        if (finished) return;
        finished = true;
        this.cancelCurrentTransfer = null;
        if (timer !== null) {
          window.clearTimeout(timer);
          this.timers.delete(timer);
        }
        if (!measurementStarted || measuredBytes <= 0) {
          reject(new Error(`LibreSpeed ${direction} test received no measurable data.`));
          return;
        }
        const elapsed = Math.max(performance.now() - measuredStartedAt, 1);
        resolve({ speed: (measuredBytes * 8 * 1.06) / (elapsed / 1000) / 1_000_000 });
      };
      const cancel = () => {
        if (finished) return;
        finished = true;
        this.cancelCurrentTransfer = null;
        reject(new Error("The LibreSpeed measurement was aborted."));
      };
      const fail = (error: Error) => {
        if (finished) return;
        finished = true;
        this.cancelCurrentTransfer = null;
        if (timer !== null) {
          window.clearTimeout(timer);
          this.timers.delete(timer);
        }
        this.activeRequests.forEach((request) => request.abort());
        this.activeRequests.clear();
        reject(error);
      };
      this.cancelCurrentTransfer = cancel;
      const launch = () => {
        if (finished || this.aborted) return;
        const request = new XMLHttpRequest();
        this.activeRequests.add(request);
        let previousBytes = 0;
        const update = (bytes: number) => {
          const delta = Math.max(0, bytes - previousBytes);
          previousBytes = bytes;
          const now = performance.now();
          if (!measurementStarted && now - startedAt >= graceDuration) {
            measurementStarted = true;
            measuredStartedAt = now;
            measuredBytes = 0;
          }
          if (measurementStarted) measuredBytes += delta;
          const elapsed = Math.max(measurementStarted ? now - measuredStartedAt : now - startedAt, 1);
          const speed = measurementStarted
            ? (measuredBytes * 8 * 1.06) / (elapsed / 1000) / 1_000_000
            : 0;
          const progress = Math.min((now - startedAt) / totalDuration, 1);
          if (direction === "download") {
            this.emit({ testState: 1, dlStatus: parseStatus(speed), dlProgress: progress });
          } else {
            this.emit({ testState: 3, ulStatus: parseStatus(speed), ulProgress: progress });
          }
        };
        request.open(direction === "download" ? "GET" : "POST", withRandomQuery(path), true);
        request.timeout = this.options.requestTimeoutMs;
        request.setRequestHeader("Cache-Control", "no-cache");
        request.setRequestHeader("Content-Encoding", "identity");
        if (direction === "download") {
          request.responseType = "arraybuffer";
          request.onprogress = (event) => update(event.loaded);
        } else {
          request.upload.onprogress = (event) => update(event.loaded);
        }
        request.onload = () => {
          this.activeRequests.delete(request);
          if (request.status < 200 || request.status >= 300) {
            fail(new Error(`LibreSpeed endpoint returned HTTP ${request.status}.`));
            return;
          }
          if (direction === "download" && request.response instanceof ArrayBuffer && previousBytes === 0) {
            update(request.response.byteLength);
          } else if (direction === "upload" && payload && previousBytes === 0) {
            update(payload.size);
          }
          if (!finished && performance.now() - startedAt < totalDuration) launch();
        };
        request.onerror = () => {
          this.activeRequests.delete(request);
          fail(new Error("The LibreSpeed measurement request failed."));
        };
        request.ontimeout = () => {
          this.activeRequests.delete(request);
          fail(new Error(`LibreSpeed endpoint timed out after ${this.options.requestTimeoutMs}ms.`));
        };
        request.onabort = () => this.activeRequests.delete(request);
        request.send(payload);
      };
      for (let index = 0; index < streams; index += 1) launch();
      timer = window.setTimeout(() => {
        const timerId = timer;
        if (timerId !== null) this.timers.delete(timerId);
        this.activeRequests.forEach((request) => request.abort());
        this.activeRequests.clear();
        complete();
      }, totalDuration);
      this.timers.add(timer);
      if (this.aborted) {
        window.clearTimeout(timer);
        cancel();
      }
    });
  }

  private url(path: string) {
    return new URL(path, this.options.baseUrl).toString();
  }
}