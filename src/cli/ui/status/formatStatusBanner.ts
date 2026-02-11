export function formatStatusBanner(banner: { face: string; label?: string }): string {
  const face = banner.face.trim();
  const label = (banner.label ?? '').trim();
  if (!label) return face;
  return `${face} ${label}`;
}
