import {
  CircleDot,
  Copy,
  CornerDownRight,
  FlipHorizontal,
  GripVertical,
  Image,
  Move,
  MoveRight,
  PenLine,
  Plus,
  RotateCcw,
  Save,
  Scissors,
  Settings,
  Slash,
  Spline,
  Trash2,
  Waypoints,
  ZoomIn,
  ZoomOut
} from "lucide-react";

export const commandRibbonIconIds = [
  "circle-dot",
  "move-right",
  "slash",
  "corner-down-right",
  "spline",
  "copy",
  "flip-horizontal",
  "scissors",
  "plus",
  "pen-line",
  "waypoints",
  "move",
  "image",
  "zoom-in",
  "zoom-out",
  "rotate-ccw",
  "save",
  "settings",
  "trash"
] as const;

export type CommandRibbonIconId = (typeof commandRibbonIconIds)[number];

export const commandRibbonIconLabels: Record<CommandRibbonIconId, string> = {
  "circle-dot": "点",
  "move-right": "移動",
  slash: "線",
  "corner-down-right": "角",
  spline: "曲線",
  copy: "コピー",
  "flip-horizontal": "反転",
  scissors: "分割",
  plus: "追加",
  "pen-line": "編集",
  waypoints: "接続",
  move: "移動2",
  image: "画像",
  "zoom-in": "拡大",
  "zoom-out": "縮小",
  "rotate-ccw": "戻す",
  save: "保存",
  settings: "設定",
  trash: "削除"
};

export const commandRibbonIconComponents = {
  "circle-dot": CircleDot,
  "move-right": MoveRight,
  slash: Slash,
  "corner-down-right": CornerDownRight,
  spline: Spline,
  copy: Copy,
  "flip-horizontal": FlipHorizontal,
  scissors: Scissors,
  plus: Plus,
  "pen-line": PenLine,
  waypoints: Waypoints,
  move: Move,
  image: Image,
  "zoom-in": ZoomIn,
  "zoom-out": ZoomOut,
  "rotate-ccw": RotateCcw,
  save: Save,
  settings: Settings,
  trash: Trash2
} satisfies Record<CommandRibbonIconId, typeof CircleDot>;

export const CommandRibbonGripIcon = GripVertical;

export const isCommandRibbonIconId = (value: unknown): value is CommandRibbonIconId =>
  typeof value === "string" && (commandRibbonIconIds as readonly string[]).includes(value);
