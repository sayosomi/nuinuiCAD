import { defaultDocumentPalette } from "../palette/palette";
import { DEFAULT_PRINT_LAYOUT } from "../print/printLayout";
import type { CadElement, DocumentPalette, NumericValue, PrintLayout, VisibilityProfile, VisibilityRole } from "../types/geometry";
import { defaultVisibilityProfile } from "../model/visibilityProfiles";
import { formatDslName, quoteDslString, unquoteDslString } from "./dslTokens";
import type { DslSettingsStatement } from "./dslSettingsParser";

/** P7-only semantic surface for settings.  It intentionally has no live imports. */
export type DslV2Settings = {
  palette: DocumentPalette;
  visibilityRoles: VisibilityRole[];
  visibilityProfiles: VisibilityProfile[];
  activeVisibilityProfileId: string;
  printLayouts: PrintLayout[];
  activePrintLayoutId: string;
};

export const emptyDslV2Settings = (): DslV2Settings => ({
  palette: defaultDocumentPalette(),
  visibilityRoles: [],
  visibilityProfiles: [defaultVisibilityProfile()],
  activeVisibilityProfileId: defaultVisibilityProfile().id,
  printLayouts: [],
  activePrintLayoutId: "",
});

const args = (statement: DslSettingsStatement) => new Map(statement.args.filter((arg) => arg.key).map((arg) => [arg.key!, arg.value]));
const bool = (value: string | undefined, fallback = false) => value === undefined ? fallback : ["true", "1", "yes", "on"].includes(value.toLowerCase());
const numeric = (value: string | undefined, fallback: NumericValue): NumericValue => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : { kind: "expression", expression: value };
};
const pair = (value: string | undefined): [NumericValue, NumericValue] | null => {
  const match = value?.match(/^\((.*),(.*)\)$/);
  return match ? [numeric(match[1].trim(), 0), numeric(match[2].trim(), 0)] : null;
};
const valueFor = (statement: DslSettingsStatement, key: string) =>
  statement.args.find((arg) => arg.key === key)?.value;
const positional = (statement: DslSettingsStatement) => statement.args.find((arg) => arg.key === null)?.value;

const profileId = (profiles: readonly VisibilityProfile[], token: string) =>
  profiles.find((profile) => profile.id === token || profile.name === token)?.id ?? token;

/** Applies one P4-parsed setting statement. Block membership is deliberately owned by the P7 harness. */
export const applyDslV2Setting = (settings: DslV2Settings, statement: DslSettingsStatement): DslV2Settings => {
  const next: DslV2Settings = {
    ...settings,
    palette: { ...settings.palette, colors: [...settings.palette.colors] },
    visibilityRoles: [...settings.visibilityRoles],
    visibilityProfiles: settings.visibilityProfiles.map((profile) => ({ ...profile, roleVisibility: { ...profile.roleVisibility } })),
    printLayouts: settings.printLayouts.map((layout) => ({ ...layout, numericVariables: [...(layout.numericVariables ?? [])], placements: [...layout.placements] })),
  };
  const named = args(statement);
  if (statement.kind === "color") {
    const hex = unquoteDslString(positional(statement) ?? "");
    const color = { id: statement.name, name: unquoteDslString(named.get("name") ?? statement.name), hex };
    const index = next.palette.colors.findIndex((item) => item.id === color.id);
    if (index >= 0) next.palette.colors[index] = color; else next.palette.colors.push(color);
    if (bool(named.get("default"))) next.palette.defaultColorId = color.id;
  } else if (statement.kind === "role") {
    const role = { id: statement.name, name: unquoteDslString(named.get("name") ?? statement.name) };
    const index = next.visibilityRoles.findIndex((item) => item.id === role.id || item.name === statement.name);
    if (index >= 0) next.visibilityRoles[index] = role; else next.visibilityRoles.push(role);
  } else if (statement.kind === "view") {
    const previous = next.visibilityProfiles.find((profile) => profile.id === statement.name || profile.name === statement.name);
    const roleVisibility = { ...(previous?.roleVisibility ?? {}) };
    for (const [key, value] of named) if (key !== "default") roleVisibility[next.visibilityRoles.find((role) => role.id === key || role.name === key)?.id ?? key] = bool(value);
    const profile: VisibilityProfile = { id: previous?.id ?? statement.name, name: statement.name, defaultRoleVisible: bool(named.get("default"), previous?.defaultRoleVisible ?? true), roleVisibility };
    const index = next.visibilityProfiles.findIndex((item) => item.id === profile.id);
    if (index >= 0) next.visibilityProfiles[index] = profile; else next.visibilityProfiles.push(profile);
  } else if (statement.kind === "activeView") {
    next.activeVisibilityProfileId = profileId(next.visibilityProfiles, statement.name);
  } else if (statement.kind === "activePrintLayout") {
    next.activePrintLayoutId = next.printLayouts.find((layout) => layout.id === statement.name || layout.name === statement.name)?.id ?? statement.name;
  }
  return next;
};

export const applyDslV2PrintLayout = (
  settings: DslV2Settings,
  header: DslSettingsStatement,
  members: readonly DslSettingsStatement[],
  elements: readonly CadElement[],
): DslV2Settings => {
  const named = args(header);
  const layout: PrintLayout = {
    ...DEFAULT_PRINT_LAYOUT,
    id: header.name,
    name: header.name,
    outputKind: named.get("output") === "svg" ? "svg" : "pdf",
    visibilityProfileId: named.get("view") ? profileId(settings.visibilityProfiles, unquoteDslString(named.get("view")!)) : undefined,
    paperSizeId: (named.get("paper") ?? DEFAULT_PRINT_LAYOUT.paperSizeId) as PrintLayout["paperSizeId"],
    orientation: named.get("orientation") === "landscape" ? "landscape" : "portrait",
    columns: numeric(named.get("columns"), DEFAULT_PRINT_LAYOUT.columns), rows: numeric(named.get("rows"), DEFAULT_PRINT_LAYOUT.rows),
    overlapMm: numeric(named.get("overlap"), DEFAULT_PRINT_LAYOUT.overlapMm), scale: numeric(named.get("scale"), DEFAULT_PRINT_LAYOUT.scale),
    svgCanvasWidthMm: pair(named.get("canvas"))?.[0] ?? DEFAULT_PRINT_LAYOUT.svgCanvasWidthMm,
    svgCanvasHeightMm: pair(named.get("canvas"))?.[1] ?? DEFAULT_PRINT_LAYOUT.svgCanvasHeightMm,
    numericVariables: [], placements: [],
  };
  for (const member of members) {
    if (member.kind === "layoutVar") layout.numericVariables!.push({ id: `print-variable-${layout.numericVariables!.length + 1}`, name: member.name, value: numeric(member.expression, 0) });
    if (member.kind === "place") {
      const at = pair(valueFor(member, "at"));
      const token = unquoteDslString(positional(member) ?? "");
      const groupId = elements.find((element) => element.id === token || element.name === token)?.id ?? token;
      layout.placements.push({ id: `placement-${layout.placements.length + 1}`, groupId, x: at?.[0] ?? 0, y: at?.[1] ?? 0, angleDeg: numeric(valueFor(member, "angle"), 0), mirrorX: bool(valueFor(member, "mirrorX")) });
    }
  }
  const layouts = settings.printLayouts.filter((item) => item.id !== layout.id).concat(layout);
  return { ...settings, printLayouts: layouts, activePrintLayoutId: settings.activePrintLayoutId || layout.id };
};

const numericText = (value: NumericValue) => typeof value === "number" ? `${value}` : value.expression;

/** Serializes only P4's setting surface; no document serializer or state store is involved. */
export const serializeDslV2Settings = (settings: DslV2Settings, elements: readonly CadElement[]): string[] => {
  const lines = ["nui 2"];
  for (const color of settings.palette.colors) lines.push(`color ${formatDslName(color.id)} (${quoteDslString(color.hex)} name: ${quoteDslString(color.name)}${color.id === settings.palette.defaultColorId ? " default: true" : ""})`);
  for (const role of settings.visibilityRoles) lines.push(`role ${formatDslName(role.id)} (name: ${quoteDslString(role.name)})`);
  for (const view of settings.visibilityProfiles) lines.push(`view ${formatDslName(view.name)} (default: ${view.defaultRoleVisible}${Object.entries(view.roleVisibility).map(([id, visible]) => ` ${formatDslName(id)}: ${visible}`).join("")})`);
  const activeView = settings.visibilityProfiles.find((view) => view.id === settings.activeVisibilityProfileId);
  if (activeView) lines.push(`activeView ${formatDslName(activeView.name)}`);
  for (const layout of settings.printLayouts) {
    const view = settings.visibilityProfiles.find((profile) => profile.id === layout.visibilityProfileId);
    lines.push(`printLayout ${formatDslName(layout.name || layout.id)} (output: ${layout.outputKind}${view ? ` view: ${formatDslName(view.name)}` : ""} paper: ${layout.paperSizeId} orientation: ${layout.orientation} columns: ${numericText(layout.columns)} rows: ${numericText(layout.rows)} overlap: ${numericText(layout.overlapMm)} scale: ${numericText(layout.scale)} canvas: (${numericText(layout.svgCanvasWidthMm)}, ${numericText(layout.svgCanvasHeightMm)})) {`);
    for (const variable of layout.numericVariables ?? []) lines.push(`  layoutVar ${formatDslName(variable.name)} = ${numericText(variable.value)}`);
    for (const placement of layout.placements) {
      const group = elements.find((element) => element.id === placement.groupId);
      lines.push(`  place ${formatDslName(group?.name || placement.groupId)} (at: (${numericText(placement.x)}, ${numericText(placement.y)}) angle: ${numericText(placement.angleDeg)} mirrorX: ${placement.mirrorX})`);
    }
    lines.push("}");
  }
  const activeLayout = settings.printLayouts.find((layout) => layout.id === settings.activePrintLayoutId);
  if (activeLayout && settings.printLayouts[0]?.id !== activeLayout.id) lines.push(`activePrintLayout ${formatDslName(activeLayout.name || activeLayout.id)}`);
  return lines;
};
