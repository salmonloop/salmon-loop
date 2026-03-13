export function formatHelpRows(
  items: Array<{ name: string; description: string; aliases?: string[] }>,
): string {
  const rows = items.map((item) => {
    const aliases = item.aliases?.length ? ` (${item.aliases.join(', ')})` : '';
    return {
      label: `${item.name}${aliases}`,
      description: item.description,
    };
  });

  const maxName = Math.max(...rows.map((row) => row.label.length), 0);
  return rows.map((row) => `${row.label}`.padEnd(maxName + 2) + row.description).join('\n');
}
