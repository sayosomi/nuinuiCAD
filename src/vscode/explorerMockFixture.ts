export type ExplorerMockTab = "elements" | "modifiers";

export type ExplorerMockActivity = "visible" | "hidden" | "disabled";
export type ExplorerMockGeometryKind =
  | "source"
  | "group"
  | "module"
  | "point"
  | "line"
  | "bezier"
  | "arc"
  | "path"
  | "operation";
export type ExplorerMockLineStyle = "solid" | "dashed" | "dotted";

export type ExplorerMockGeometry = {
  id: string;
  name: string;
  kind: ExplorerMockGeometryKind;
  parentId: string | null;
  activity: ExplorerMockActivity;
  color: string;
  style: ExplorerMockLineStyle;
  width: number;
  category: "drafting" | "construction" | "presentation" | "source-flow";
  moduleOrigin?: string;
  diagnostic?: { severity: "error" | "warning"; message: string };
  branch?: "active" | "inactive";
  branchGroupId?: string;
  references?: string[];
  detail: {
    expression: string;
    values: Array<[string, string]>;
    inputs: string[];
    dependents: string[];
    upstreamCount: number;
    downstreamCount: number;
    pathDescription?: string;
    winningSource?: string;
    modifierId?: string;
  };
};

export type ExplorerMockModifier = {
  id: string;
  name: string;
  effectSummary: string;
  usageCount: number;
  zeroUse?: boolean;
  profileOnly?: boolean;
  category: "common" | "profile" | "presentation";
  effects: Array<{ name: string; value: string; effectiveness: "Effective" | "Partially Effective" | "Not Effective" }>;
  profiles: Array<{
    name: string;
    cells: Array<{ label: string; value: string; overridden?: boolean }>;
  }>;
  appliedTo: Array<{ label: string; effectiveness: "Effective" | "Partially Effective" | "Not Effective" }>;
};

const geometryDetail = (
  expression: string,
  values: Array<[string, string]>,
  options: Partial<ExplorerMockGeometry["detail"]> = {}
): ExplorerMockGeometry["detail"] => ({
  expression,
  values,
  inputs: options.inputs ?? [],
  dependents: options.dependents ?? [],
  upstreamCount: options.upstreamCount ?? 0,
  downstreamCount: options.downstreamCount ?? 0,
  pathDescription: options.pathDescription,
  winningSource: options.winningSource,
  modifierId: options.modifierId
});

export const explorerMockGeometry: readonly ExplorerMockGeometry[] = [
  {
    id: "source-bodice",
    name: "Bodice.nui",
    kind: "source",
    parentId: null,
    activity: "visible",
    color: "#7b61ff",
    style: "solid",
    width: 1,
    category: "source-flow",
    detail: geometryDetail("source \"Bodice.nui\"", [["Statements", "42"], ["Status", "Ready"]])
  },
  {
    id: "group-pattern",
    name: "Pattern",
    kind: "group",
    parentId: "source-bodice",
    activity: "visible",
    color: "#6b7280",
    style: "solid",
    width: 1,
    category: "construction",
    detail: geometryDetail("group Pattern", [["Members", "18"], ["Activity", "Visible"]], { inputs: ["source-bodice"] })
  },
  {
    id: "module-front",
    name: "Front panel",
    kind: "module",
    parentId: "group-pattern",
    activity: "visible",
    color: "#3b82f6",
    style: "solid",
    width: 1,
    category: "construction",
    detail: geometryDetail("module FrontPanel", [["Origin", "Bodice.nui:12"], ["Members", "9"]], { inputs: ["group-pattern"], dependents: ["module-back"] })
  },
  {
    id: "front-neck",
    name: "Neck point",
    kind: "point",
    parentId: "module-front",
    activity: "visible",
    color: "#eab308",
    style: "solid",
    width: 1,
    category: "drafting",
    moduleOrigin: "Front panel",
    detail: geometryDetail("point Neck = coordinate(42.0, 286.5)", [["Position", "(42.0, 286.5) mm"], ["Angle", "0°"]], { inputs: ["front-shoulder"], dependents: ["front-neck-curve"], upstreamCount: 2, downstreamCount: 1, winningSource: "Base Line Style", modifierId: "modifier-base" })
  },
  {
    id: "front-shoulder",
    name: "Shoulder point",
    kind: "point",
    parentId: "module-front",
    activity: "visible",
    color: "#eab308",
    style: "solid",
    width: 1,
    category: "drafting",
    moduleOrigin: "Front panel",
    detail: geometryDetail("point Shoulder = coordinate(128.0, 278.0)", [["Position", "(128.0, 278.0) mm"], ["Angle", "-5°"]], { inputs: ["front-armhole"], dependents: ["front-neck"], upstreamCount: 1, downstreamCount: 2 })
  },
  {
    id: "front-neck-curve",
    name: "Neckline",
    kind: "bezier",
    parentId: "module-front",
    activity: "visible",
    color: "#22c55e",
    style: "solid",
    width: 1.5,
    category: "drafting",
    moduleOrigin: "Front panel",
    detail: geometryDetail("bezier Neckline", [["Length", "146.2 mm"], ["Start", "Neck point"], ["End", "Center front"]], { inputs: ["front-neck", "front-shoulder"], dependents: ["front-contour"], upstreamCount: 4, downstreamCount: 2, pathDescription: "Responsive split: 42% / 58% across the neckline.", winningSource: "Contrast Stitch", modifierId: "modifier-contrast" })
  },
  {
    id: "front-armhole",
    name: "Armhole",
    kind: "bezier",
    parentId: "module-front",
    activity: "visible",
    color: "#22c55e",
    style: "dashed",
    width: 1.5,
    category: "drafting",
    moduleOrigin: "Front panel",
    diagnostic: { severity: "warning", message: "Control handle is inferred from the responsive split." },
    detail: geometryDetail("bezier Armhole", [["Length", "238.7 mm"], ["Start", "Shoulder point"], ["End", "Underarm"]], { inputs: ["front-shoulder"], dependents: ["front-contour"], upstreamCount: 3, downstreamCount: 2, pathDescription: "Responsive split: shoulder 35% / underarm 65%." })
  },
  {
    id: "front-side-seam",
    name: "Side seam",
    kind: "line",
    parentId: "module-front",
    activity: "hidden",
    color: "#f97316",
    style: "dotted",
    width: 1,
    category: "construction",
    moduleOrigin: "Front panel",
    detail: geometryDetail("line SideSeam", [["Length", "412.0 mm"], ["Start", "Underarm"], ["End", "Hem"], ["State", "Hidden"]], { inputs: ["front-armhole"], dependents: ["front-contour"], upstreamCount: 3, downstreamCount: 1 })
  },
  {
    id: "front-hem-arc",
    name: "Hem ease arc",
    kind: "arc",
    parentId: "module-front",
    activity: "disabled",
    color: "#ef4444",
    style: "dashed",
    width: 1,
    category: "construction",
    moduleOrigin: "Front panel",
    diagnostic: { severity: "error", message: "References the disabled hem guide." },
    detail: geometryDetail("arc HemEase", [["Radius", "28.0 mm"], ["Sweep", "32°"], ["State", "Disabled"]], { inputs: ["front-side-seam"], dependents: [], upstreamCount: 2, downstreamCount: 0 })
  },
  {
    id: "front-contour",
    name: "Front contour",
    kind: "path",
    parentId: "module-front",
    activity: "visible",
    color: "#14b8a6",
    style: "solid",
    width: 2,
    category: "presentation",
    moduleOrigin: "Front panel",
    detail: geometryDetail("path FrontContour", [["Length", "1,248.4 mm"], ["Segments", "7"], ["Closed", "Yes"]], { inputs: ["front-neck-curve", "front-armhole", "front-side-seam"], dependents: [], upstreamCount: 8, downstreamCount: 1, pathDescription: "Split path: neckline → armhole → side seam → hem.", winningSource: "Base Line Style", modifierId: "modifier-base" })
  },
  {
    id: "branch-fit",
    name: "Fit branch",
    kind: "group",
    parentId: "group-pattern",
    activity: "visible",
    color: "#64748b",
    style: "solid",
    width: 1,
    category: "construction",
    branch: "active",
    branchGroupId: "fit-branch",
    detail: geometryDetail("conditional FitBranch", [["Condition", "bustEase > 0"], ["Active", "true"]], { inputs: ["group-pattern"], dependents: ["fit-dart"] })
  },
  {
    id: "fit-dart",
    name: "Bust dart",
    kind: "line",
    parentId: "branch-fit",
    activity: "visible",
    color: "#a855f7",
    style: "solid",
    width: 1,
    category: "drafting",
    branch: "active",
    branchGroupId: "fit-branch",
    detail: geometryDetail("line BustDart", [["Length", "96.0 mm"], ["State", "Active branch"]], { inputs: ["front-contour"], dependents: ["fit-branch"], upstreamCount: 4, downstreamCount: 1 })
  },
  {
    id: "branch-fit-alt",
    name: "Fit branch (alternate)",
    kind: "group",
    parentId: "group-pattern",
    activity: "visible",
    color: "#64748b",
    style: "solid",
    width: 1,
    category: "construction",
    branch: "inactive",
    branchGroupId: "fit-branch",
    detail: geometryDetail("conditional FitBranch", [["Condition", "bustEase <= 0"], ["Active", "false"]], { inputs: ["group-pattern"], dependents: [] })
  },
  {
    id: "fit-pleat-alt",
    name: "Ease pleat",
    kind: "line",
    parentId: "branch-fit-alt",
    activity: "visible",
    color: "#a855f7",
    style: "dashed",
    width: 1,
    category: "drafting",
    branch: "inactive",
    branchGroupId: "fit-branch",
    detail: geometryDetail("line EasePleat", [["Length", "62.0 mm"], ["State", "Inactive branch"]], { inputs: ["front-contour"], dependents: [] })
  },
  {
    id: "module-back",
    name: "Back panel",
    kind: "module",
    parentId: "group-pattern",
    activity: "visible",
    color: "#3b82f6",
    style: "solid",
    width: 1,
    category: "construction",
    detail: geometryDetail("module BackPanel", [["Origin", "Bodice.nui:29"], ["Members", "7"]], { inputs: ["group-pattern"], dependents: ["front-contour"] })
  },
  {
    id: "back-center",
    name: "Center back",
    kind: "line",
    parentId: "module-back",
    activity: "visible",
    color: "#06b6d4",
    style: "solid",
    width: 1,
    category: "drafting",
    moduleOrigin: "Back panel",
    detail: geometryDetail("line CenterBack", [["Length", "482.0 mm"], ["Angle", "90°"]], { inputs: ["module-back"], dependents: ["back-neck"], upstreamCount: 2, downstreamCount: 2 })
  },
  {
    id: "back-neck",
    name: "Back neckline",
    kind: "arc",
    parentId: "module-back",
    activity: "visible",
    color: "#06b6d4",
    style: "solid",
    width: 1.5,
    category: "drafting",
    moduleOrigin: "Back panel",
    detail: geometryDetail("arc BackNeckline", [["Radius", "74.5 mm"], ["Sweep", "46°"]], { inputs: ["back-center"], dependents: ["back-contour"], upstreamCount: 2, downstreamCount: 1 })
  },
  {
    id: "back-contour",
    name: "Back contour",
    kind: "path",
    parentId: "module-back",
    activity: "visible",
    color: "#06b6d4",
    style: "dashed",
    width: 2,
    category: "presentation",
    moduleOrigin: "Back panel",
    detail: geometryDetail("path BackContour", [["Length", "1,314.8 mm"], ["Segments", "6"], ["Closed", "Yes"]], { inputs: ["back-center", "back-neck"], dependents: [], upstreamCount: 7, downstreamCount: 0, winningSource: "Profile Hem", modifierId: "modifier-profile" })
  },
  {
    id: "operation-seam-flow",
    name: "Apply seam allowance",
    kind: "operation",
    parentId: "group-pattern",
    activity: "visible",
    color: "#94a3b8",
    style: "dotted",
    width: 1,
    category: "source-flow",
    detail: geometryDetail("operation seamAllowance", [["Inputs", "Front contour, Back contour"], ["Output", "Seam boundary"]], { inputs: ["front-contour", "back-contour"], dependents: [] })
  }
];

export const explorerMockModifiers: readonly ExplorerMockModifier[] = [
  {
    id: "modifier-base",
    name: "Base Line Style",
    effectSummary: "Default stroke presentation",
    usageCount: 8,
    category: "common",
    effects: [
      { name: "Color", value: "Effective · inherits element", effectiveness: "Effective" },
      { name: "Width", value: "1.0 mm", effectiveness: "Effective" },
      { name: "Style", value: "Solid", effectiveness: "Effective" }
    ],
    profiles: [
      { name: "Draft", cells: [{ label: "Color", value: "Element" }, { label: "Width", value: "1.0 mm" }, { label: "Style", value: "Solid" }] },
      { name: "Print", cells: [{ label: "Color", value: "Element" }, { label: "Width", value: "1.0 mm" }, { label: "Style", value: "Solid" }] }
    ],
    appliedTo: [
      { label: "Front contour", effectiveness: "Effective" },
      { label: "Neckline", effectiveness: "Effective" },
      { label: "Center back", effectiveness: "Effective" }
    ]
  },
  {
    id: "modifier-contrast",
    name: "Contrast Stitch",
    effectSummary: "Accent line · width 1.5 mm",
    usageCount: 2,
    category: "presentation",
    effects: [
      { name: "Color", value: "#e879f9", effectiveness: "Effective" },
      { name: "Width", value: "1.5 mm", effectiveness: "Effective" },
      { name: "Style", value: "Dashed", effectiveness: "Partially Effective" }
    ],
    profiles: [
      { name: "Draft", cells: [{ label: "Color", value: "#e879f9", overridden: true }, { label: "Width", value: "1.5 mm", overridden: true }, { label: "Style", value: "Dashed" }] },
      { name: "Print", cells: [{ label: "Color", value: "Element" }, { label: "Width", value: "Element" }, { label: "Style", value: "Solid" }] }
    ],
    appliedTo: [
      { label: "Neckline", effectiveness: "Effective" },
      { label: "Armhole", effectiveness: "Partially Effective" }
    ]
  },
  {
    id: "modifier-profile",
    name: "Profile Hem",
    effectSummary: "Print profile override",
    usageCount: 3,
    profileOnly: true,
    category: "profile",
    effects: [
      { name: "Color", value: "No direct effect", effectiveness: "Not Effective" },
      { name: "Width", value: "No direct effect", effectiveness: "Not Effective" },
      { name: "Style", value: "Print only · Dotted", effectiveness: "Effective" }
    ],
    profiles: [
      { name: "Draft", cells: [{ label: "Color", value: "Element" }, { label: "Width", value: "Element" }, { label: "Style", value: "Element" }] },
      { name: "Print", cells: [{ label: "Color", value: "#fb7185", overridden: true }, { label: "Width", value: "2.0 mm", overridden: true }, { label: "Style", value: "Dotted", overridden: true }] }
    ],
    appliedTo: [
      { label: "Back contour · Print", effectiveness: "Effective" },
      { label: "Hem allowance · Print", effectiveness: "Effective" }
    ]
  },
  {
    id: "modifier-seam-guide",
    name: "Seam Guide",
    effectSummary: "Construction guide · currently unused",
    usageCount: 0,
    zeroUse: true,
    category: "common",
    effects: [
      { name: "Color", value: "#94a3b8", effectiveness: "Not Effective" },
      { name: "Width", value: "0.5 mm", effectiveness: "Not Effective" },
      { name: "Style", value: "Dotted", effectiveness: "Not Effective" }
    ],
    profiles: [
      { name: "Draft", cells: [{ label: "Color", value: "#94a3b8" }, { label: "Width", value: "0.5 mm" }, { label: "Style", value: "Dotted" }] }
    ],
    appliedTo: []
  },
  {
    id: "modifier-draft-cleanup",
    name: "Draft Cleanup",
    effectSummary: "Suppress construction helpers",
    usageCount: 3,
    category: "presentation",
    effects: [
      { name: "Color", value: "No effect", effectiveness: "Partially Effective" },
      { name: "Width", value: "0.75 mm", effectiveness: "Effective" },
      { name: "State", value: "Hide helper lines", effectiveness: "Effective" }
    ],
    profiles: [
      { name: "Draft", cells: [{ label: "Color", value: "Element" }, { label: "Width", value: "0.75 mm", overridden: true }, { label: "State", value: "Hidden", overridden: true }] },
      { name: "Print", cells: [{ label: "Color", value: "Element" }, { label: "Width", value: "Element" }, { label: "State", value: "Visible" }] }
    ],
    appliedTo: [
      { label: "Side seam", effectiveness: "Effective" },
      { label: "Hem ease arc", effectiveness: "Partially Effective" }
    ]
  }
];

export const explorerMockRootIds = explorerMockGeometry
  .filter((geometry) => geometry.parentId === null)
  .map((geometry) => geometry.id);

export const explorerMockGeometryById = new Map(explorerMockGeometry.map((geometry) => [geometry.id, geometry]));
export const explorerMockModifierById = new Map(explorerMockModifiers.map((modifier) => [modifier.id, modifier]));

export const explorerMockChildrenOf = (parentId: string | null): ExplorerMockGeometry[] =>
  explorerMockGeometry.filter((geometry) => geometry.parentId === parentId);

export const explorerMockIsContainer = (geometry: ExplorerMockGeometry): boolean =>
  explorerMockGeometry.some((candidate) => candidate.parentId === geometry.id);

export const explorerMockAncestorsOf = (id: string): string[] => {
  const ancestors: string[] = [];
  let current = explorerMockGeometryById.get(id);
  while (current?.parentId) {
    ancestors.unshift(current.parentId);
    current = explorerMockGeometryById.get(current.parentId);
  }
  return ancestors;
};

export const explorerMockTypeLabel = (kind: ExplorerMockGeometryKind): string => {
  const labels: Record<ExplorerMockGeometryKind, string> = {
    source: "Source",
    group: "Group",
    module: "Module",
    point: "Point",
    line: "Line",
    bezier: "Bezier",
    arc: "Arc",
    path: "Path",
    operation: "Operation"
  };
  return labels[kind];
};

