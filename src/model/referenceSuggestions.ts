import { elementNameTokensForContext, elementQualifiedName } from "./elementNames";
import type { PickCandidate, PickOption } from "./pickCandidates";
import { pickRefForOption, pickRefKey, type PickRef } from "./pickReferences";
import { formatDslReferenceToken } from "../dsl/dslReferenceTokens";
import type { CadElement } from "../types/geometry";

export type ReferenceSuggestion = {
  pickRef: PickRef;
  pickRefKey: string;
  displayLabel: string;
  canonicalToken: string;
  searchAliases: string[];
  detail: string;
};

const derivedSuffix = (pointKey: string) => {
  if (pointKey === "start") return { token: ".start", label: "・始点", aliases: ["start", "始点"] };
  if (pointKey === "end") return { token: ".end", label: "・終点", aliases: ["end", "終点"] };
  if (pointKey === "center") return { token: ".center", label: "・中心点", aliases: ["center", "中心点"] };
  return { token: `.${pointKey}`, label: `・${pointKey}`, aliases: [pointKey] };
};

const optionPresentation = (option: PickOption) => {
  if (option.kind === "line") return { suffix: "", labelSuffix: "", aliases: [] as string[], detail: "line" };
  if (option.kind !== "point") return null;
  if (option.anchor.mode === "reference") {
    return { suffix: "", labelSuffix: "", aliases: [] as string[], detail: "point" };
  }
  if (option.anchor.mode === "derived") {
    const suffix = derivedSuffix(option.anchor.pointKey);
    return { suffix: suffix.token, labelSuffix: suffix.label, aliases: suffix.aliases, detail: "derived point" };
  }
  return null;
};

export const referenceSuggestions = ({
  candidates,
  elements,
  currentElement
}: {
  candidates: readonly PickCandidate[];
  elements: CadElement[];
  currentElement?: Pick<CadElement, "parentGroupId">;
}): ReferenceSuggestion[] => {
  const tokensByElementId = new Map<string, string[]>();
  for (const { token, element } of elementNameTokensForContext({ elements, currentElement })) {
    const tokens = tokensByElementId.get(element.id) ?? [];
    tokens.push(token);
    tokensByElementId.set(element.id, tokens);
  }
  const elementsById = new Map(elements.map((element) => [element.id, element]));

  return candidates.flatMap((candidate) => {
    const element = elementsById.get(candidate.elementId);
    const rawTokens = tokensByElementId.get(candidate.elementId) ?? [];
    const canonicalBase = [...rawTokens].sort((left, right) => left.length - right.length)[0];
    if (!element || !canonicalBase) return [];
    const qualifiedName = elementQualifiedName(element, elements);
    const formattedBase = formatDslReferenceToken(canonicalBase);

    return candidate.options.flatMap((option) => {
      const presentation = optionPresentation(option);
      if (!presentation) return [];
      const pickRef = pickRefForOption(candidate.elementId, option);
      const canonicalToken = `${formattedBase}${presentation.suffix}`;
      const displayLabel = `${qualifiedName}${presentation.labelSuffix}`;
      return [{
        pickRef,
        pickRefKey: pickRefKey(pickRef),
        displayLabel,
        canonicalToken,
        searchAliases: [
          element.name,
          qualifiedName,
          formattedBase,
          canonicalToken,
          displayLabel,
          ...presentation.aliases,
          ...presentation.aliases.map((alias) => `${qualifiedName}.${alias}`)
        ],
        detail: presentation.detail
      }];
    });
  });
};

const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase();

export const rankedReferenceSuggestions = (
  suggestions: readonly ReferenceSuggestion[],
  query: string,
  limit = 8
) => {
  const needle = normalized(query.trim());
  if (!needle) return [];
  return suggestions
    .map((suggestion, documentOrder) => {
      const aliases = suggestion.searchAliases.map(normalized);
      const score = aliases.some((alias) => alias === needle)
        ? 0
        : aliases.some((alias) => alias.startsWith(needle))
          ? 1
          : aliases.some((alias) => alias.includes(needle))
            ? 2
            : null;
      return { suggestion, documentOrder, score };
    })
    .filter((item): item is typeof item & { score: number } => item.score !== null)
    .sort((left, right) => left.score - right.score || left.documentOrder - right.documentOrder)
    .slice(0, limit)
    .map((item) => item.suggestion);
};
