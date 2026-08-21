export interface WatchLoopOptions {
  intervalSeconds: number;
  onTick: () => void;
  clearScreen?: boolean;
}

export function runWatchLoop(options: WatchLoopOptions): void {
  const tick = (): void => {
    if (options.clearScreen !== false) {
      process.stdout.write("\u001b[2J\u001b[0;0H");
    }
    options.onTick();
  };

  tick();
  const interval = setInterval(tick, Math.max(1, options.intervalSeconds) * 1000);

  const stop = (): void => {
    clearInterval(interval);
    process.exit(0);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
