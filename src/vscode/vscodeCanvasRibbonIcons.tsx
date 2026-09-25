import {
  CircleDot,
  Crosshair,
  FileDown,
  Grid3X3,
  Magnet,
  Maximize,
  Minus,
  Plus,
  RotateCcw,
  Ruler,
  Tag,
  type LucideIcon
} from "lucide-react";

export const vscodeLucideIconRegistry = {
  "circle-dot": CircleDot,
  crosshair: Crosshair,
  "file-down": FileDown,
  "grid-3x3": Grid3X3,
  magnet: Magnet,
  maximize: Maximize,
  minus: Minus,
  plus: Plus,
  "rotate-ccw": RotateCcw,
  ruler: Ruler,
  tag: Tag
} satisfies Record<string, LucideIcon>;

export type VscodeLucideIconName = keyof typeof vscodeLucideIconRegistry;

export const vscodeLucideIconName = <Name extends VscodeLucideIconName>(name: Name): Name => name;

export const isVscodeLucideIconName = (name: string): name is VscodeLucideIconName =>
  Object.hasOwn(vscodeLucideIconRegistry, name);

export const resolveVscodeLucideIcon = (name: string): LucideIcon => {
  if (!isVscodeLucideIconName(name)) throw new Error(`Unregistered VS Code Webview icon: ${name}`);
  return vscodeLucideIconRegistry[name];
};
