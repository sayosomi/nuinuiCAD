import type { CommandId } from "./commandTypes";
import type { CommandContext } from "./commandTypes";

export type CommandPaletteItem = {
  commandId: CommandId;
  label: string;
  keywords: string[];
  isAvailable?: (context?: CommandContext) => boolean;
};

const normalizePaletteText = (text: string) => text.trim().toLowerCase();

export const filterCommandPaletteItems = (
  items: CommandPaletteItem[],
  query: string,
  context?: CommandContext
) => {
  const normalizedQuery = normalizePaletteText(query);
  const availableItems = items.filter((item) => item.isAvailable?.(context) ?? true);
  if (!normalizedQuery) return availableItems;

  return availableItems.filter((item) => {
    const searchableText = [item.commandId, item.label, ...item.keywords]
      .map(normalizePaletteText)
      .join(" ");
    return searchableText.includes(normalizedQuery);
  });
};
