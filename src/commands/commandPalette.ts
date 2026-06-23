import type { CommandId } from "./commandTypes";

export type CommandPaletteItem = {
  commandId: CommandId;
  label: string;
  keywords: string[];
};

const normalizePaletteText = (text: string) => text.trim().toLowerCase();

export const filterCommandPaletteItems = (items: CommandPaletteItem[], query: string) => {
  const normalizedQuery = normalizePaletteText(query);
  if (!normalizedQuery) return items;

  return items.filter((item) => {
    const searchableText = [item.commandId, item.label, ...item.keywords]
      .map(normalizePaletteText)
      .join(" ");
    return searchableText.includes(normalizedQuery);
  });
};
