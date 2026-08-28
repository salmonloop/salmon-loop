// Expected Impact: Reduces string allocations and padding operations per render cycle
const PADDED_NUMBERS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

export function formatTime(timestamp: Date): string {
  const hours = PADDED_NUMBERS[timestamp.getHours()];
  const minutes = PADDED_NUMBERS[timestamp.getMinutes()];
  const seconds = PADDED_NUMBERS[timestamp.getSeconds()];
  return `${hours}:${minutes}:${seconds}`;
}
