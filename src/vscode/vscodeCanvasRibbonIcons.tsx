import { forwardRef, type ComponentProps } from "react";
import { Circle, type LucideIcon } from "lucide-react";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";

export const VSCODE_CANVAS_RIBBON_FALLBACK_ICON = "circle" as const;

export const resolveVscodeLucideIconName = (value: unknown): IconName =>
  typeof value === "string" && (iconNames as readonly string[]).includes(value)
    ? value as IconName
    : VSCODE_CANVAS_RIBBON_FALLBACK_ICON;

type DynamicIconProps = ComponentProps<typeof DynamicIcon>;

const iconCache = new Map<IconName, LucideIcon>();

export const resolveVscodeLucideIcon = (value: unknown): LucideIcon => {
  const name = resolveVscodeLucideIconName(value);
  const cached = iconCache.get(name);
  if (cached) return cached;
  const Icon = forwardRef<SVGSVGElement, DynamicIconProps>((props, ref) => (
    <DynamicIcon
      {...props}
      ref={ref}
      name={name}
      fallback={() => <Circle {...props} ref={ref} />}
    />
  ));
  iconCache.set(name, Icon as LucideIcon);
  return Icon as LucideIcon;
};
