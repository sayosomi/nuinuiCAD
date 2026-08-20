export const commandRibbonIconSizes = [14, 16, 18, 20, 24] as const;

export type CommandRibbonIconSize = (typeof commandRibbonIconSizes)[number];

export const commandRibbonIconColors = [
  "default",
  "teal",
  "blue",
  "green",
  "amber",
  "orange",
  "red",
  "pink",
  "purple",
  "slate"
] as const;

export type CommandRibbonIconColor = (typeof commandRibbonIconColors)[number];

export const commandRibbonIconColorLabels: Record<CommandRibbonIconColor, string> = {
  default: "標準",
  teal: "青緑",
  blue: "青",
  green: "緑",
  amber: "黄",
  orange: "橙",
  red: "赤",
  pink: "桃",
  purple: "紫",
  slate: "灰"
};

export const commandRibbonIconColorValues: Record<CommandRibbonIconColor, string> = {
  default: "currentColor",
  teal: "#0f766e",
  blue: "#2563eb",
  green: "#15803d",
  amber: "#b7791f",
  orange: "#c2410c",
  red: "#dc2626",
  pink: "#db2777",
  purple: "#7c3aed",
  slate: "#475569"
};
