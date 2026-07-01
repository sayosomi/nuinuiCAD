import type { DocumentPalette, PaletteColor } from "../types/geometry";

export const DEFAULT_PALETTE_COLORS: PaletteColor[] = [
  { id: "pattern-black", name: "基本線", hex: "#31322f" },
  { id: "cut-red", name: "裁断線", hex: "#b42318" },
  { id: "guide-blue", name: "補助線", hex: "#2563eb" },
  { id: "mark-green", name: "印", hex: "#15803d" },
  { id: "note-amber", name: "注記", hex: "#b45309" }
];

export const defaultDocumentPalette = (): DocumentPalette => ({
  colors: DEFAULT_PALETTE_COLORS.map((color) => ({ ...color })),
  defaultColorId: DEFAULT_PALETTE_COLORS[0].id
});

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeHexColor = (value: unknown, fallback: string) =>
  typeof value === "string" && HEX_COLOR_PATTERN.test(value) ? value.toLowerCase() : fallback;

export const isValidPaletteColorId = (palette: DocumentPalette, colorId: string | undefined) =>
  Boolean(colorId && palette.colors.some((color) => color.id === colorId));

export const paletteColorById = (palette: DocumentPalette) =>
  new Map(palette.colors.map((color) => [color.id, color]));

export const normalizeDocumentPalette = (value: unknown): DocumentPalette => {
  const fallback = defaultDocumentPalette();
  if (!isRecord(value) || !Array.isArray(value.colors)) return fallback;

  const usedIds = new Set<string>();
  const colors = value.colors
    .map((item, index): PaletteColor | null => {
      if (!isRecord(item) || typeof item.id !== "string" || item.id.trim() === "") {
        return null;
      }
      const id = item.id.trim();
      if (usedIds.has(id)) return null;
      usedIds.add(id);
      const fallbackColor = fallback.colors[index % fallback.colors.length] ?? fallback.colors[0];
      return {
        id,
        name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : fallbackColor.name,
        hex: normalizeHexColor(item.hex, fallbackColor.hex)
      };
    })
    .filter((color): color is PaletteColor => Boolean(color));

  if (colors.length === 0) return fallback;

  const requestedDefaultId =
    typeof value.defaultColorId === "string" ? value.defaultColorId : colors[0].id;
  const defaultColorId = colors.some((color) => color.id === requestedDefaultId)
    ? requestedDefaultId
    : colors[0].id;

  return { colors, defaultColorId };
};

export const createPaletteColorId = (colors: PaletteColor[]) => {
  const existingIds = new Set(colors.map((color) => color.id));
  let index = colors.length + 1;
  while (existingIds.has(`color-${index}`)) index += 1;
  return `color-${index}`;
};

export const createPaletteColor = (colors: PaletteColor[]): PaletteColor => {
  const id = createPaletteColorId(colors);
  return {
    id,
    name: `色${colors.length + 1}`,
    hex: "#64748b"
  };
};
