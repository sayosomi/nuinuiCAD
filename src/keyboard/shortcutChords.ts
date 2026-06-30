import type { KeyChord, ShortcutModifier } from "./shortcutTypes";

const modifierMatches = (actual: boolean, expected: ShortcutModifier | undefined) => {
  if (expected === "any") return true;
  return actual === Boolean(expected);
};

const eventUsesMod = (event: KeyboardEvent) => event.metaKey || event.ctrlKey;

export const keyChordMatchesEvent = (chord: KeyChord, event: KeyboardEvent) =>
  event.key.toLowerCase() === chord.key.toLowerCase() &&
  modifierMatches(eventUsesMod(event), chord.mod) &&
  modifierMatches(event.altKey, chord.alt) &&
  modifierMatches(event.shiftKey, chord.shift);

export const keyChordId = (chord: KeyChord) =>
  [
    chord.mod === "any" ? "mod:any" : `mod:${Boolean(chord.mod)}`,
    chord.alt === "any" ? "alt:any" : `alt:${Boolean(chord.alt)}`,
    chord.shift === "any" ? "shift:any" : `shift:${Boolean(chord.shift)}`,
    `key:${chord.key.toLowerCase()}`
  ].join("|");

export const keyChordEquals = (left: KeyChord, right: KeyChord) =>
  keyChordId(left) === keyChordId(right);

const keyLabels: Record<string, string> = {
  " ": "Space"
};

export const keyChordLabel = (chord: KeyChord) => {
  const modifiers = [];
  if (chord.mod === true) modifiers.push("Mod");
  if (chord.alt === true) modifiers.push("Alt");
  if (chord.shift === true) modifiers.push("Shift");
  modifiers.push(keyLabels[chord.key] ?? chord.key);
  return modifiers.join("+");
};

export const keyChordListLabel = (chords: KeyChord[]) =>
  chords.length === 0 ? "未設定" : chords.map(keyChordLabel).join(" / ");

export const keyChordFromEvent = (event: KeyboardEvent): KeyChord | null => {
  if (event.key === "Meta" || event.key === "Control" || event.key === "Alt" || event.key === "Shift") {
    return null;
  }
  return {
    key: event.key,
    mod: event.metaKey || event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey
  };
};
