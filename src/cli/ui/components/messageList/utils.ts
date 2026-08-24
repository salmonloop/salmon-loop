// Pre-compute array lookups for bounded date values (0-59)
// to avoid repeated string allocations in high-frequency React render paths.
const PAD_2 = Array.from({ length: 60 }, (_, i) => (i < 10 ? `0${i}` : `${i}`));

export function formatTime(timestamp: Date): string {
  const hours = PAD_2[timestamp.getHours()] || String(timestamp.getHours()).padStart(2, '0');
  const minutes = PAD_2[timestamp.getMinutes()] || String(timestamp.getMinutes()).padStart(2, '0');
  const seconds = PAD_2[timestamp.getSeconds()] || String(timestamp.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}
