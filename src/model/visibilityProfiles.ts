import { groupStateByElementId, isGroupElement } from "./groups";
import type {
  CadElement,
  ElementId,
  VisibilityProfile,
  VisibilityRole
} from "../types/geometry";

export const DEFAULT_VISIBILITY_PROFILE_ID = "default";

export const defaultVisibilityProfile = (): VisibilityProfile => ({
  id: DEFAULT_VISIBILITY_PROFILE_ID,
  name: "通常表示",
  defaultRoleVisible: true,
  roleVisibility: {}
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const visibilityIdFromName = (name: string, fallback: string) => {
  const normalized = name.trim().replace(/\s+/g, "-");
  return normalized.length > 0 ? normalized : fallback;
};

const uniqueId = (requested: string, usedIds: Set<string>) => {
  const base = requested.trim().length > 0 ? requested.trim() : "role";
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  let index = 2;
  while (usedIds.has(`${base}-${index}`)) index += 1;
  const id = `${base}-${index}`;
  usedIds.add(id);
  return id;
};

export const roleIdsForElement = (element: CadElement): string[] =>
  element.type === "group" ? element.visibilityRoleIds ?? [] : [];

export const normalizeVisibilityRoles = (
  roles: unknown,
  elements: CadElement[] = []
): VisibilityRole[] => {
  const usedIds = new Set<string>();
  const normalized: VisibilityRole[] = [];
  if (Array.isArray(roles)) {
    for (const role of roles) {
      if (!isRecord(role)) continue;
      const rawId = typeof role.id === "string" ? role.id.trim() : "";
      const rawName = typeof role.name === "string" ? role.name.trim() : "";
      const id = uniqueId(rawId || visibilityIdFromName(rawName, "role"), usedIds);
      normalized.push({ id, name: rawName || id });
    }
  }

  for (const element of elements) {
    for (const roleId of roleIdsForElement(element)) {
      if (typeof roleId !== "string" || roleId.trim().length === 0 || usedIds.has(roleId)) {
        continue;
      }
      usedIds.add(roleId);
      normalized.push({ id: roleId, name: roleId });
    }
  }

  return normalized;
};

export const normalizeVisibilityProfiles = ({
  profiles,
  roles
}: {
  profiles: unknown;
  roles: VisibilityRole[];
}): VisibilityProfile[] => {
  const roleIds = new Set(roles.map((role) => role.id));
  const usedIds = new Set<string>();
  const normalized: VisibilityProfile[] = [];
  const source = Array.isArray(profiles) && profiles.length > 0
    ? profiles
    : [defaultVisibilityProfile()];

  for (const profile of source) {
    if (!isRecord(profile)) continue;
    const rawId = typeof profile.id === "string" ? profile.id.trim() : "";
    const rawName = typeof profile.name === "string" ? profile.name.trim() : "";
    const id = uniqueId(rawId || visibilityIdFromName(rawName, DEFAULT_VISIBILITY_PROFILE_ID), usedIds);
    const roleVisibility: Record<string, boolean> = {};
    const rawRoleVisibility = isRecord(profile.roleVisibility) ? profile.roleVisibility : {};
    for (const [roleId, value] of Object.entries(rawRoleVisibility)) {
      if (roleIds.has(roleId)) roleVisibility[roleId] = value === true;
    }
    normalized.push({
      id,
      name: rawName || id,
      defaultRoleVisible:
        typeof profile.defaultRoleVisible === "boolean"
          ? profile.defaultRoleVisible
          : true,
      roleVisibility
    });
  }

  return normalized.length > 0 ? normalized : [defaultVisibilityProfile()];
};

export const normalizeGroupVisibilityRoleIds = (
  element: CadElement,
  roles: VisibilityRole[]
): CadElement => {
  if (element.type !== "group") return element;
  const roleIds = new Set(roles.map((role) => role.id));
  const normalizedIds = Array.from(new Set(element.visibilityRoleIds ?? []))
    .filter((roleId) => roleIds.has(roleId));
  return normalizedIds.length > 0
    ? { ...element, visibilityRoleIds: normalizedIds }
    : withoutVisibilityRoleIds(element);
};

const withoutVisibilityRoleIds = (element: Extract<CadElement, { type: "group" }>): CadElement => {
  const next = { ...element };
  delete next.visibilityRoleIds;
  return next;
};

export const visibilityProfileById = (
  profiles: VisibilityProfile[],
  profileId: string | null | undefined
) =>
  profiles.find((profile) => profile.id === profileId) ??
  profiles.find((profile) => profile.id === DEFAULT_VISIBILITY_PROFILE_ID) ??
  profiles[0] ??
  defaultVisibilityProfile();

export const roleVisibleInProfile = (
  profile: VisibilityProfile,
  roleId: string
) => profile.roleVisibility[roleId] ?? profile.defaultRoleVisible;

const groupVisibleByOwnRoles = (
  group: Extract<CadElement, { type: "group" }>,
  profile: VisibilityProfile
) => {
  const roleIds = group.visibilityRoleIds ?? [];
  if (roleIds.length === 0) return true;
  return roleIds.some((roleId) => roleVisibleInProfile(profile, roleId));
};

const hiddenByVisibilityRole = (
  element: CadElement,
  elementsById: Map<ElementId, CadElement>,
  profile: VisibilityProfile,
  cache: Map<ElementId, boolean>,
  visiting = new Set<ElementId>()
): boolean => {
  const cached = cache.get(element.id);
  if (cached !== undefined) return cached;
  if (visiting.has(element.id)) return false;
  visiting.add(element.id);

  let hidden = false;
  const parent = element.parentGroupId ? elementsById.get(element.parentGroupId) : null;
  if (parent && isGroupElement(parent)) {
    hidden =
      hiddenByVisibilityRole(parent, elementsById, profile, cache, visiting) ||
      (parent.type === "group" && !groupVisibleByOwnRoles(parent, profile));
  }
  if (!hidden && element.type === "group") {
    hidden = !groupVisibleByOwnRoles(element, profile);
  }

  visiting.delete(element.id);
  cache.set(element.id, hidden);
  return hidden;
};

export const effectiveVisibleElementIdsForProfile = ({
  elements,
  profile
}: {
  elements: CadElement[];
  profile: VisibilityProfile;
}) => {
  const states = groupStateByElementId(elements);
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const roleHiddenCache = new Map<ElementId, boolean>();
  return new Set(
    elements
      .filter((element) =>
        element.activity === "visible" &&
        !states.get(element.id)?.hiddenByGroupId &&
        !hiddenByVisibilityRole(element, elementsById, profile, roleHiddenCache)
      )
      .map((element) => element.id)
  );
};

export const visibilityRoleNamesById = (roles: VisibilityRole[]) =>
  new Map(roles.map((role) => [role.id, role.name]));
