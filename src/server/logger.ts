// Plain, timestamped logging to stdout/stderr — what `docker compose logs` shows.
function line(level: string, message: string): string {
  return `${new Date().toISOString()} ${level.padEnd(5)} ${message}`;
}

export const logger = {
  info(message: string): void {
    console.log(line("info", message));
  },
  warn(message: string): void {
    console.warn(line("warn", message));
  },
  error(message: string): void {
    console.error(line("error", message));
  },
};
