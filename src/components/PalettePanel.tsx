import { useState } from "react";
import {
  loadPaletteTemplateSettings,
  savePaletteTemplateSettings
} from "../palette/paletteSettingsStorage";
import { useCadDocumentStore } from "../state/cadDocumentStore";

export const PalettePanel = () => {
  const palette = useCadDocumentStore((state) => state.palette);
  const addPaletteColor = useCadDocumentStore((state) => state.addPaletteColor);
  const deletePaletteColor = useCadDocumentStore((state) => state.deletePaletteColor);
  const setDefaultColorId = useCadDocumentStore((state) => state.setDefaultColorId);
  const setPalette = useCadDocumentStore((state) => state.setPalette);
  const updatePaletteColor = useCadDocumentStore((state) => state.updatePaletteColor);
  const [status, setStatus] = useState<string | null>(null);

  const saveTemplate = async () => {
    try {
      await savePaletteTemplateSettings(palette);
      setStatus("テンプレートに保存しました。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "テンプレートを保存できません。");
    }
  };

  const applyTemplate = async () => {
    try {
      const settings = await loadPaletteTemplateSettings();
      setPalette(settings.palette);
      setStatus("テンプレートを適用しました。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "テンプレートを適用できません。");
    }
  };

  return (
    <section className="panel-section palette-panel">
      <div className="section-header">
        <div>
          <h2>パレット</h2>
          <p className="section-subtitle">表示色と既定色</p>
        </div>
      </div>
      <div className="palette-color-list">
        {palette.colors.map((color) => (
          <div className="palette-color-row" key={color.id}>
            <input
              type="color"
              value={color.hex}
              aria-label={`${color.name} の色`}
              onChange={(event) => updatePaletteColor(color.id, { hex: event.target.value })}
            />
            <input
              key={`${color.id}:${color.name}`}
              defaultValue={color.name}
              aria-label={`${color.name} の名前`}
              onBlur={(event) => updatePaletteColor(color.id, { name: event.currentTarget.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  event.currentTarget.value = color.name;
                  event.currentTarget.blur();
                }
              }}
            />
            <button
              type="button"
              className={palette.defaultColorId === color.id ? "active-toggle" : ""}
              onClick={() => setDefaultColorId(color.id)}
            >
              既定
            </button>
            <button
              type="button"
              disabled={palette.defaultColorId === color.id}
              onClick={() => deletePaletteColor(color.id)}
            >
              削除
            </button>
          </div>
        ))}
      </div>
      <div className="button-row">
        <button type="button" onClick={addPaletteColor}>色を追加</button>
        <button type="button" onClick={saveTemplate}>テンプレートに保存</button>
        <button type="button" onClick={applyTemplate}>テンプレートを適用</button>
      </div>
      {status ? <p className="palette-status">{status}</p> : null}
    </section>
  );
};
