// Pre-computed array for 0-59 to avoid String().padStart() allocations in hot paths
const PADDED_TIME_VALUES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

export function formatTime(timestamp: Date): string {
  // Use non-null assertion since getHours/Minutes/Seconds always return 0-59
  const hours = PADDED_TIME_VALUES[timestamp.getHours()]!;
  const minutes = PADDED_TIME_VALUES[timestamp.getMinutes()]!;
  const seconds = PADDED_TIME_VALUES[timestamp.getSeconds()]!;
  return `${hours}:${minutes}:${seconds}`;
}
