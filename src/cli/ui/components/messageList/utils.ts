export function formatTime(timestamp: Date): string {
  const hours = String(timestamp.getHours()).padStart(2, '0');
  const minutes = String(timestamp.getMinutes()).padStart(2, '0');
  const seconds = String(timestamp.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}
