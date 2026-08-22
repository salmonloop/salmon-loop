const PAD_2 = Array.from({ length: 60 }, (_, i) => (i < 10 ? `0${i}` : `${i}`));

export function formatTime(timestamp: Date): string {
  // Performance: Pre-computed array lookups for 0-59 are faster than String().padStart()
  // avoiding repeated string allocations in high-throughput render paths.
  const hours = PAD_2[timestamp.getHours()];
  const minutes = PAD_2[timestamp.getMinutes()];
  const seconds = PAD_2[timestamp.getSeconds()];
  return `${hours}:${minutes}:${seconds}`;
}
