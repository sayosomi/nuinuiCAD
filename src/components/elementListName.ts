export const ELEMENT_LIST_COMPACT_NAME_THRESHOLD = 18;

export const elementListNameTextClassName = (displayName: string) =>
  `element-name-text${
    displayName.length > ELEMENT_LIST_COMPACT_NAME_THRESHOLD ? " is-compact-name" : ""
  }`;
