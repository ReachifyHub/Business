// src/utils/helpers.ts
export function parseHooks(vaultText: string) {
  const hooks = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const line of vaultText.split("\n")) {
    const match = line.match(/^#{2,3}\s+\d+\.\s+(.+)/);
    if (match) {
      if (current) hooks.push(current);
      current = { title: match[1].trim(), lines: [] };
    } else if (current && line.trim()) {
      current.lines.push(line);
    }
  }
  if (current) hooks.push(current);
  return hooks;
}

export function extractSelarLink(vaultText: string): string {
  const match = vaultText.match(/^SELAR_LINK:\s*(.+)$/m);
  return match ? match[1].trim() : "https://selar.co/";
}
