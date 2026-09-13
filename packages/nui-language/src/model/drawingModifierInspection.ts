import type {
  DrawingModifierStrokeColor,
  DrawingModifierStrokeStyle,
  ElementId
} from "../types/geometry";

/**
 * Exact-current authored winner for one effective Drawing Modifier property.
 *
 * `modifierName` is the current document's canonical style identity: the
 * compiler and StatementMap both key top-level style source ownership by
 * this unique name. A selected profile override additionally carries the
 * compiler-resolved profile declaration id so later source navigation never
 * needs to parse a runtime id or search source text.
 */
export type DrawingModifierPropertyWinner = {
  ownerElementId: ElementId;
  modifierName: string;
  selectedProfileDelta: {
    profileId: string;
    profileName: string;
  } | null;
};

export type DrawingModifierPropertyResolution<T> = {
  value: T;
  winner: DrawingModifierPropertyWinner | null;
};

/**
 * Winner-only Style/Profile inspection for one runtime element.
 * Built-in defaults deliberately use `winner: null` rather than inventing a
 * source location. Style visibility is presentation-only and cannot disable
 * computation or override a direct/ancestor visible:false hard gate.
 */
export type EffectiveDrawingModifierResolution = {
  visible: DrawingModifierPropertyResolution<boolean>;
  widthPx: DrawingModifierPropertyResolution<number>;
  lineType: DrawingModifierPropertyResolution<DrawingModifierStrokeStyle>;
  color: DrawingModifierPropertyResolution<DrawingModifierStrokeColor>;
};
