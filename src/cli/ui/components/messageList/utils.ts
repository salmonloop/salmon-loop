// Pre-computed array lookup for time values (0-59) to avoid string allocations
// and padStart() overhead during high-throughput React rendering
const timeLookup = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

export function formatTime(timestamp: Date): string {
  return `${timeLookup[timestamp.getHours()] as string}:${timeLookup[timestamp.getMinutes()] as string}:${timeLookup[timestamp.getSeconds()] as string}`;
}
