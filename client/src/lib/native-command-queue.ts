let nativeQueue: Promise<void> = Promise.resolve();

export function enqueueNativeCommand<T>(operation: () => Promise<T>): Promise<T> {
  const queued = nativeQueue
    .catch(() => undefined)
    .then(operation);
  nativeQueue = queued.then(() => undefined, () => undefined);
  return queued;
}