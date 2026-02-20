export type MessageDensity = 'verbose' | 'normal' | 'dense';

export function resolveMessageDensity(raw: unknown): MessageDensity {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (value === 'verbose' || value === 'normal' || value === 'dense') return value;
  return 'normal';
}
