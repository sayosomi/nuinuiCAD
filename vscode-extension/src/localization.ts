export type SupportedLocale = "ja" | "en";

export type TranslationParameters = Readonly<Record<string, string | number | boolean>>;

export type TranslationEntry = Readonly<{
  en: string;
  ja?: string;
}>;

export type TranslationCatalog = Readonly<Record<string, TranslationEntry>>;

/** SAY-83 catalog entries used by the native Signature Help presentation. */
export const signatureHelpTranslationCatalog = {
  "signatureHelp.builtin.abs": { en: "Returns the absolute value.", ja: "絶対値を返します。" },
  "signatureHelp.builtin.min": { en: "Returns the smaller of two numbers.", ja: "2つの数値の小さい方を返します。" },
  "signatureHelp.builtin.max": { en: "Returns the larger of two numbers.", ja: "2つの数値の大きい方を返します。" },
  "signatureHelp.builtin.sqrt": { en: "Returns the square root of a number.", ja: "数値の平方根を返します。" },
  "signatureHelp.builtin.round": { en: "Rounds a number.", ja: "数値を丸めます。" },
  "signatureHelp.builtin.floor": { en: "Rounds a number down.", ja: "数値を切り捨てます。" },
  "signatureHelp.builtin.ceil": { en: "Rounds a number up.", ja: "数値を切り上げます。" },
  "signatureHelp.builtin.roundTo": { en: "Rounds a number to a specified step.", ja: "数値を指定した刻みに丸めます。" },
  "signatureHelp.builtin.isClose": { en: "Tests whether numbers are close within a tolerance.", ja: "数値が許容差内で近いか判定します。" },
  "signatureHelp.builtin.sin": { en: "Returns the sine of an angle.", ja: "角度の正弦を返します。" },
  "signatureHelp.builtin.cos": { en: "Returns the cosine of an angle.", ja: "角度の余弦を返します。" },
  "signatureHelp.builtin.tan": { en: "Returns the tangent of an angle.", ja: "角度の正接を返します。" },
  "signatureHelp.builtin.asin": { en: "Returns the inverse sine.", ja: "逆正弦を返します。" },
  "signatureHelp.builtin.acos": { en: "Returns the inverse cosine.", ja: "逆余弦を返します。" },
  "signatureHelp.builtin.atan": { en: "Returns the inverse tangent.", ja: "逆正接を返します。" },
  "signatureHelp.builtin.atan2": { en: "Returns the signed angle from two coordinates.", ja: "2つの座標から符号付き角度を返します。" },
  "signatureHelp.builtin.spreadAngle": { en: "Computes an angle spread from a length and spread value.", ja: "長さと広がりから角度の広がりを計算します。" },
  "signatureHelp.builtin.distance": { en: "Measures the distance between two points.", ja: "2点間の距離を測定します。" },
  "signatureHelp.builtin.angle": { en: "Measures the angle between two points.", ja: "2点間の角度を測定します。" },
  "signatureHelp.builtin.lineDistance": { en: "Measures the distance from a point to a line.", ja: "点から線までの距離を測定します。" },
  "signatureHelp.builtin.lineAngle": { en: "Measures the angle between two lines.", ja: "2本の線の間の角度を測定します。" },
  "signatureHelp.builtin.spreadAngle.length": { en: "Base length for the angle spread.", ja: "角度の広がりの基準となる長さです。" },
  "signatureHelp.builtin.spreadAngle.spread": { en: "Amount of angular spread to apply.", ja: "適用する角度の広がりです。" },

  "signatureHelp.parameter.number": { en: "Numeric argument.", ja: "数値の引数です。" },
  "signatureHelp.parameter.point": { en: "Point argument.", ja: "点の引数です。" },
  "signatureHelp.parameter.line": { en: "Line argument.", ja: "線の引数です。" },
  "signatureHelp.parameter.pointReference": { en: "Point used by this construction.", ja: "この構築で使用する点です。" },
  "signatureHelp.parameter.lineEndpointReference": { en: "Line endpoint used by this construction.", ja: "この構築で使用する線の端点です。" },
  "signatureHelp.parameter.lineReference": { en: "Single line used by this construction.", ja: "この構築で使用する1本の線です。" },
  "signatureHelp.parameter.lineReferenceList": { en: "List of source lines used by this construction.", ja: "この構築で使用する線の一覧です。" },
  "signatureHelp.parameter.boolean": { en: "Boolean option.", ja: "真偽値のオプションです。" },
  "signatureHelp.parameter.choice": { en: "Select one of the allowed values.", ja: "許可された値から1つを選びます。" },
  "signatureHelp.parameter.text": { en: "Text value.", ja: "テキスト値です。" },
  "signatureHelp.parameter.color": { en: "Display color.", ja: "表示色です。" },
  "signatureHelp.parameter.argument": { en: "Argument for this callable.", ja: "この呼び出しの引数です。" },

  "signatureHelp.construction.point.coordinate": { en: "Creates a point at coordinates.", ja: "座標に点を作成します。" },
  "signatureHelp.construction.point.offset": { en: "Creates a point offset from another point.", ja: "別の点からオフセットした点を作成します。" },
  "signatureHelp.construction.point.polar": { en: "Creates a point at an angle and distance from another point.", ja: "別の点から角度と距離で点を作成します。" },
  "signatureHelp.construction.point.between": { en: "Creates a point between two points.", ja: "2点の間に点を作成します。" },
  "signatureHelp.construction.point.onLine": { en: "Creates a point on a line.", ja: "線上に点を作成します。" },
  "signatureHelp.construction.point.intersection": { en: "Creates a point at the intersection of two lines.", ja: "2本の線の交点に点を作成します。" },
  "signatureHelp.construction.point.tangentOffset": { en: "Creates a point offset along a line tangent.", ja: "線の接線方向にオフセットした点を作成します。" },
  "signatureHelp.construction.point.bezierExtremePoint": { en: "Creates an extreme point on a Bézier line.", ja: "ベジェ線上の極値点を作成します。" },
  "signatureHelp.construction.point.bezierBulgePoint": { en: "Creates a bulge point on a Bézier line.", ja: "ベジェ線上の膨らみ点を作成します。" },
  "signatureHelp.construction.line.segment": { en: "Creates a line segment.", ja: "線分を作成します。" },
  "signatureHelp.construction.line.polar": { en: "Creates a line from an angle and length.", ja: "角度と長さから線を作成します。" },
  "signatureHelp.construction.line.offset": { en: "Creates an offset line.", ja: "オフセット線を作成します。" },
  "signatureHelp.construction.line.split": { en: "Splits a line at a point.", ja: "点で線を分割します。" },
  "signatureHelp.construction.line.transformCopy": { en: "Creates a transformed copy of lines.", ja: "線を変換したコピーを作成します。" },
  "signatureHelp.construction.line.mirrorCopy": { en: "Creates a mirrored copy of lines.", ja: "線を反転したコピーを作成します。" },
  "signatureHelp.construction.mutation.edge": { en: "Builds an edge from two line endpoints.", ja: "2つの線の端点からエッジを作成します。" },
  "signatureHelp.construction.mutation.extend": { en: "Extends or trims a line to a point.", ja: "点まで線を延長または短縮します。" },
  "signatureHelp.construction.mutation.move": { en: "Moves target lines with a transform.", ja: "対象の線を変換して移動します。" },
  "signatureHelp.construction.mutation.mirrorMove": { en: "Moves target lines by mirroring them.", ja: "対象の線を反転して移動します。" },
  "signatureHelp.construction.mutation.reverse": { en: "Reverses the direction of a line.", ja: "線の向きを反転します。" },
  "signatureHelp.construction.curve.bezier": { en: "Creates a Bézier curve.", ja: "ベジェ曲線を作成します。" },
  "signatureHelp.construction.arc.arc": { en: "Creates an arc.", ja: "円弧を作成します。" },
  "signatureHelp.construction.arc.through": { en: "Creates an arc through three points.", ja: "3点を通る円弧を作成します。" },
  "signatureHelp.construction.arc.corner": { en: "Creates a corner-radius arc.", ja: "コーナー半径の円弧を作成します。" },
  "signatureHelp.construction.text.label": { en: "Creates a text label.", ja: "テキストラベルを作成します。" },
  "signatureHelp.construction.image.image": { en: "Creates an image underlay.", ja: "画像の下敷きを作成します。" },
  "signatureHelp.construction.group.group": { en: "Starts a group.", ja: "グループを開始します。" },
  "signatureHelp.construction.if.if": { en: "Starts a conditional group.", ja: "条件グループを開始します。" },
  "signatureHelp.construction.for.for": { en: "Starts a repeated group.", ja: "繰り返しグループを開始します。" },
  "signatureHelp.construction.point.coordinate.x": { en: "X coordinate of the point.", ja: "点のX座標です。" },
  "signatureHelp.construction.point.coordinate.y": { en: "Y coordinate of the point.", ja: "点のY座標です。" },
  "signatureHelp.construction.line.segment.start": { en: "Start point of the segment.", ja: "線分の始点です。" },
  "signatureHelp.construction.line.segment.end": { en: "End point of the segment.", ja: "線分の終点です。" },
  "signatureHelp.construction.line.offset.distance": { en: "Distance of the offset from the source line.", ja: "基準線からのオフセット距離です。" },
  "signatureHelp.construction.line.offset.side": { en: "Side where the offset is placed.", ja: "オフセットを配置する側です。" },
  "signatureHelp.construction.line.offset.closed": { en: "Whether the offset result is closed.", ja: "オフセット結果を閉じるかどうかです。" },

  "signatureHelp.module": { en: "Calls a user-defined module.", ja: "ユーザー定義モジュールを呼び出します。" },
  "signatureHelp.module.parameter": { en: "Parameter declared by the module.", ja: "モジュールで宣言されたパラメータです。" }
} satisfies TranslationCatalog;

export const resolveLocale = (displayLanguage: string): SupportedLocale =>
  displayLanguage === "ja" || displayLanguage.startsWith("ja-") ? "ja" : "en";

const interpolate = (text: string, parameters: TranslationParameters | undefined): string => {
  if (!parameters) return text;

  return text.replace(/\{([A-Za-z0-9_.-]+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(parameters, name) ? String(parameters[name]) : placeholder
  );
};

export type Translator = (key: string, parameters?: TranslationParameters) => string;

export const createTranslator = (catalog: TranslationCatalog, locale: SupportedLocale = "en"): Translator =>
  (key, parameters) => {
    const entry = catalog[key];
    if (!entry) return key;

    const text = locale === "ja" ? entry.ja ?? entry.en : entry.en;
    return interpolate(text, parameters);
  };
