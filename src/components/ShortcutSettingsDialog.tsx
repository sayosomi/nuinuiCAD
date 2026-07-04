import { useEffect, useMemo, useState } from "react";
import { dispatchCommand } from "../commands/commands";
import {
  configurableShortcutBindings,
  defaultShortcutSettings,
  effectiveShortcutBindings,
  keyChordFromEvent,
  keyChordLabel,
  keyChordListLabel,
  keyChordMatchesSearch,
  shortcutConflicts
} from "../keyboard/shortcuts";
import { keyChordEquals } from "../keyboard/shortcutChords";
import { saveShortcutSettings } from "../keyboard/shortcutSettingsStorage";
import type { KeyChord, ShortcutSettings } from "../keyboard/shortcuts";
import { useCadUiStore } from "../state/cadUiStore";

const scopeLabels = {
  global: "全体",
  modeInvariant: "全モード",
  normal: "通常",
  parameter: "パラメーター編集",
  dependencyJump: "親子ジャンプ",
  pick: "構成リスト選択"
};

const sameChords = (left: KeyChord[], right: KeyChord[]) =>
  left.length === right.length && left.every((chord, index) => keyChordEquals(chord, right[index]));

const settingWithBindingChords = (
  settings: ShortcutSettings,
  bindingId: string,
  chords: KeyChord[]
): ShortcutSettings => {
  const binding = configurableShortcutBindings.find((item) => item.id === bindingId);
  if (!binding) return settings;
  const overrides = settings.overrides.filter((override) => override.bindingId !== bindingId);
  if (!sameChords(chords, binding.defaultChords)) {
    overrides.push({ bindingId, chords });
  }
  return { version: 1, overrides };
};

const commandFilterText = (binding: (typeof configurableShortcutBindings)[number]) =>
  `${binding.label} ${binding.commandId} ${scopeLabels[binding.scope]}`.toLowerCase();

export const ShortcutSettingsDialog = () => {
  const showShortcutSettings = useCadUiStore((state) => state.showShortcutSettings);
  const shortcutSettings = useCadUiStore((state) => state.shortcutSettings);
  if (!showShortcutSettings) return null;
  return <ShortcutSettingsDialogContent shortcutSettings={shortcutSettings} />;
};

const ShortcutSettingsDialogContent = ({
  shortcutSettings
}: {
  shortcutSettings: ShortcutSettings;
}) => {
  const shortcutSettingsLoading = useCadUiStore((state) => state.shortcutSettingsLoading);
  const shortcutSettingsError = useCadUiStore((state) => state.shortcutSettingsError);
  const setShortcutSettings = useCadUiStore((state) => state.setShortcutSettings);
  const setShortcutSettingsLoading = useCadUiStore((state) => state.setShortcutSettingsLoading);
  const setShortcutSettingsError = useCadUiStore((state) => state.setShortcutSettingsError);
  const [draftSettings, setDraftSettings] = useState(shortcutSettings);
  const [query, setQuery] = useState("");
  const [searchChord, setSearchChord] = useState<KeyChord | null>(null);
  const [isRecordingSearchChord, setIsRecordingSearchChord] = useState(false);
  const [recordingBindingId, setRecordingBindingId] = useState<string | null>(null);
  const bindings = useMemo(() => effectiveShortcutBindings(draftSettings), [draftSettings]);
  const bindingById = useMemo(
    () => new Map(bindings.map((binding) => [binding.id, binding])),
    [bindings]
  );
  const filteredBindings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return configurableShortcutBindings.filter((binding) => {
      if (normalizedQuery && !commandFilterText(binding).includes(normalizedQuery)) {
        return false;
      }
      if (!searchChord) return true;
      const effectiveBinding = bindingById.get(binding.id);
      return Boolean(effectiveBinding?.chords.some((chord) => keyChordMatchesSearch(chord, searchChord)));
    });
  }, [bindingById, query, searchChord]);
  const conflicts = useMemo(() => shortcutConflicts(draftSettings), [draftSettings]);
  const hasChanges = JSON.stringify(shortcutSettings) !== JSON.stringify(draftSettings);

  useEffect(() => {
    if (!isRecordingSearchChord) return;

    const recordSearchKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setIsRecordingSearchChord(false);
        return;
      }

      const chord = keyChordFromEvent(event);
      if (!chord) return;

      setSearchChord(chord);
      setIsRecordingSearchChord(false);
    };

    window.addEventListener("keydown", recordSearchKey, { capture: true });
    return () => window.removeEventListener("keydown", recordSearchKey, { capture: true });
  }, [isRecordingSearchChord]);

  useEffect(() => {
    if (!recordingBindingId) return;

    const recordKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecordingBindingId(null);
        return;
      }

      const chord = keyChordFromEvent(event);
      if (!chord) return;

      setDraftSettings((current) => {
        const binding = effectiveShortcutBindings(current).find((item) => item.id === recordingBindingId);
        const nextChords = binding?.chords.some((item) => keyChordEquals(item, chord))
          ? binding.chords
          : [...(binding?.chords ?? []), chord];
        return settingWithBindingChords(current, recordingBindingId, nextChords);
      });
      setRecordingBindingId(null);
    };

    window.addEventListener("keydown", recordKey, { capture: true });
    return () => window.removeEventListener("keydown", recordKey, { capture: true });
  }, [recordingBindingId]);

  const updateBindingChords = (bindingId: string, chords: KeyChord[]) => {
    setDraftSettings((current) => settingWithBindingChords(current, bindingId, chords));
  };

  const startSearchKeyRecording = () => {
    setRecordingBindingId(null);
    setIsRecordingSearchChord(true);
  };

  const startBindingKeyRecording = (bindingId: string) => {
    setIsRecordingSearchChord(false);
    setRecordingBindingId(bindingId);
  };

  const saveSettings = async () => {
    if (conflicts.length > 0) {
      setShortcutSettingsError("同じモード内で同じキーが複数のコマンドに割り当てられています。");
      return;
    }

    setShortcutSettingsLoading(true);
    setShortcutSettingsError(null);
    try {
      await saveShortcutSettings(draftSettings);
      setShortcutSettings(draftSettings);
      dispatchCommand("closeShortcutSettings");
    } catch (error) {
      setShortcutSettingsError(
        error instanceof Error ? error.message : "ショートカット設定を保存できません。"
      );
    } finally {
      setShortcutSettingsLoading(false);
    }
  };

  return (
    <div className="shortcut-settings-backdrop">
      <section
        className="shortcut-settings"
        role="dialog"
        aria-modal="true"
        aria-label="ショートカット設定"
      >
        <div className="shortcut-overlay-header">
          <div>
            <h2>ショートカット設定</h2>
            <p>キーだけで実行できるコマンド</p>
          </div>
          <button type="button" onClick={() => dispatchCommand("closeShortcutSettings")}>
            閉じる
          </button>
        </div>

        <div className="shortcut-settings-toolbar">
          <input
            value={query}
            placeholder="コマンドを検索"
            aria-label="ショートカット設定を検索"
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="shortcut-settings-key-search">
            <button type="button" onClick={startSearchKeyRecording}>
              {isRecordingSearchChord ? "検索キー入力中..." : "キーで検索"}
            </button>
            {searchChord ? (
              <>
                <span aria-label="検索中のショートカットキー">{keyChordLabel(searchChord)}</span>
                <button type="button" onClick={() => setSearchChord(null)}>
                  クリア
                </button>
              </>
            ) : null}
          </div>
          <button type="button" onClick={() => setDraftSettings(defaultShortcutSettings())}>
            すべて初期値
          </button>
        </div>

        <div className="shortcut-settings-errors">
          {shortcutSettingsError ? (
            <p className="shortcut-settings-error" role="alert">
              {shortcutSettingsError}
            </p>
          ) : null}
          {conflicts.length > 0 ? (
            <p className="shortcut-settings-error" role="alert">
              {conflicts.length}件のキー重複があります。
            </p>
          ) : null}
        </div>

        <div className="shortcut-settings-list">
          {filteredBindings.length === 0 ? (
            <p className="shortcut-settings-empty-state">一致するショートカットはありません。</p>
          ) : null}
          {filteredBindings.map((sourceBinding) => {
            const binding = bindingById.get(sourceBinding.id) ?? {
              ...sourceBinding,
              chords: sourceBinding.defaultChords
            };
            const conflict = conflicts.some((item) => item.bindingIds.includes(binding.id));
            return (
              <div
                className={`shortcut-settings-row ${conflict ? "conflict" : ""}`}
                key={binding.id}
              >
                <div className="shortcut-settings-command">
                  <strong>{binding.label}</strong>
                  <span>{scopeLabels[binding.scope]} / {binding.commandId}</span>
                </div>
                <div className="shortcut-settings-keys" aria-label={`${binding.label} のキー`}>
                  {binding.chords.length === 0 ? (
                    <span className="shortcut-settings-empty">未設定</span>
                  ) : (
                    binding.chords.map((chord, index) => (
                      <button
                        type="button"
                        key={`${keyChordLabel(chord)}-${index}`}
                        onClick={() =>
                          updateBindingChords(
                            binding.id,
                            binding.chords.filter((_, itemIndex) => itemIndex !== index)
                          )
                        }
                        aria-label={`${keyChordLabel(chord)} を解除`}
                      >
                        {keyChordLabel(chord)}
                      </button>
                    ))
                  )}
                </div>
                <div className="shortcut-settings-actions">
                  <button type="button" onClick={() => startBindingKeyRecording(binding.id)}>
                    {recordingBindingId === binding.id ? "入力中..." : "キー追加"}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateBindingChords(binding.id, binding.defaultChords)}
                  >
                    初期値
                  </button>
                  <button type="button" onClick={() => updateBindingChords(binding.id, [])}>
                    解除
                  </button>
                </div>
                <small>初期値: {keyChordListLabel(binding.defaultChords)}</small>
              </div>
            );
          })}
        </div>

        <div className="shortcut-settings-footer">
          <button type="button" onClick={() => dispatchCommand("closeShortcutSettings")}>
            キャンセル
          </button>
          <button
            type="button"
            disabled={shortcutSettingsLoading || conflicts.length > 0 || !hasChanges}
            onClick={saveSettings}
          >
            {shortcutSettingsLoading ? "保存中..." : "保存"}
          </button>
        </div>
      </section>
    </div>
  );
};
