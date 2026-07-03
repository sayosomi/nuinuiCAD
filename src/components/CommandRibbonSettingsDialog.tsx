import { useMemo, useState } from "react";
import { dispatchCommand, commandPaletteItems, commands, type CommandId } from "../commands/commands";
import {
  commandRibbonIconSizes,
  defaultCommandRibbonSettings,
  normalizeCommandRibbonSettings,
  saveCommandRibbonSettings,
  type CommandRibbon,
  type CommandRibbonButton,
  type CommandRibbonIconSize,
  type CommandRibbonSettings
} from "../commandRibbons/commandRibbonSettings";
import {
  commandRibbonIconComponents,
  commandRibbonIconIds,
  commandRibbonIconLabels,
  type CommandRibbonIconId
} from "../commandRibbons/commandRibbonIcons";
import { useCadUiStore } from "../state/cadUiStore";

const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const firstCommandId = commandPaletteItems[0]?.commandId ?? "addLine";

const commandLabel = (commandId: CommandId) => commands[commandId]?.label ?? commandId;

const defaultButton = (): CommandRibbonButton => ({
  id: newId("button"),
  commandId: firstCommandId,
  icon: "slash",
  label: commandLabel(firstCommandId),
  showLabel: false
});

const defaultRibbon = (index: number): CommandRibbon => ({
  id: newId("ribbon"),
  label: `リボン ${index + 1}`,
  x: null,
  y: 12 + index * 44,
  orientation: "horizontal",
  iconSize: 16,
  buttons: [defaultButton()]
});

const commandSearchText = (commandId: CommandId) =>
  `${commandLabel(commandId)} ${commandId} ${(commands[commandId].palette?.keywords ?? []).join(" ")}`.toLowerCase();

const withRibbon = (
  settings: CommandRibbonSettings,
  ribbonId: string,
  update: (ribbon: CommandRibbon) => CommandRibbon
): CommandRibbonSettings => ({
  version: 1,
  ribbons: settings.ribbons.map((ribbon) => (ribbon.id === ribbonId ? update(ribbon) : ribbon))
});

const withButton = (
  settings: CommandRibbonSettings,
  ribbonId: string,
  buttonId: string,
  update: (button: CommandRibbonButton) => CommandRibbonButton
): CommandRibbonSettings =>
  withRibbon(settings, ribbonId, (ribbon) => ({
    ...ribbon,
    buttons: ribbon.buttons.map((button) => (button.id === buttonId ? update(button) : button))
  }));

export const CommandRibbonSettingsDialog = () => {
  const showCommandRibbonSettings = useCadUiStore((state) => state.showCommandRibbonSettings);
  const commandRibbonSettings = useCadUiStore((state) => state.commandRibbonSettings);
  if (!showCommandRibbonSettings) return null;
  return (
    <CommandRibbonSettingsDialogContent
      commandRibbonSettings={commandRibbonSettings ?? defaultCommandRibbonSettings()}
    />
  );
};

const CommandRibbonSettingsDialogContent = ({
  commandRibbonSettings
}: {
  commandRibbonSettings: CommandRibbonSettings;
}) => {
  const commandRibbonSettingsLoading = useCadUiStore((state) => state.commandRibbonSettingsLoading);
  const commandRibbonSettingsError = useCadUiStore((state) => state.commandRibbonSettingsError);
  const setCommandRibbonSettings = useCadUiStore((state) => state.setCommandRibbonSettings);
  const setCommandRibbonSettingsLoading = useCadUiStore(
    (state) => state.setCommandRibbonSettingsLoading
  );
  const setCommandRibbonSettingsError = useCadUiStore(
    (state) => state.setCommandRibbonSettingsError
  );
  const [draftSettings, setDraftSettings] = useState(commandRibbonSettings);
  const [selectedRibbonId, setSelectedRibbonId] = useState(draftSettings.ribbons[0]?.id ?? "");
  const [commandQuery, setCommandQuery] = useState("");
  const selectedRibbon =
    draftSettings.ribbons.find((ribbon) => ribbon.id === selectedRibbonId) ??
    draftSettings.ribbons[0] ??
    null;
  const hasChanges = JSON.stringify(commandRibbonSettings) !== JSON.stringify(draftSettings);
  const filteredCommands = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) return commandPaletteItems;
    return commandPaletteItems.filter((item) => commandSearchText(item.commandId).includes(query));
  }, [commandQuery]);
  const commandOptionsForButton = (button: CommandRibbonButton) =>
    filteredCommands.some((item) => item.commandId === button.commandId)
      ? filteredCommands
      : [
          {
            commandId: button.commandId,
            label: commandLabel(button.commandId),
            keywords: []
          },
          ...filteredCommands
        ];

  const close = () => dispatchCommand("closeCommandRibbonSettings");

  const saveSettings = async () => {
    setCommandRibbonSettingsLoading(true);
    setCommandRibbonSettingsError(null);
    try {
      const normalized = normalizeCommandRibbonSettings(draftSettings);
      await saveCommandRibbonSettings(normalized);
      setCommandRibbonSettings(normalized);
      close();
    } catch (error) {
      setCommandRibbonSettingsError(
        error instanceof Error ? error.message : "コマンドリボン設定を保存できません。"
      );
    } finally {
      setCommandRibbonSettingsLoading(false);
    }
  };

  const selectRibbon = (ribbonId: string) => setSelectedRibbonId(ribbonId);

  const addRibbon = () => {
    setDraftSettings((current) => {
      const ribbon = defaultRibbon(current.ribbons.length);
      setSelectedRibbonId(ribbon.id);
      return { version: 1, ribbons: [...current.ribbons, ribbon] };
    });
  };

  const duplicateRibbon = () => {
    if (!selectedRibbon) return;
    const duplicate = {
      ...selectedRibbon,
      id: newId("ribbon"),
      label: `${selectedRibbon.label} コピー`,
      x: selectedRibbon.x === null ? null : selectedRibbon.x + 32,
      y: selectedRibbon.y + 32,
      buttons: selectedRibbon.buttons.map((button) => ({ ...button, id: newId("button") }))
    };
    setDraftSettings((current) => ({ version: 1, ribbons: [...current.ribbons, duplicate] }));
    setSelectedRibbonId(duplicate.id);
  };

  const deleteRibbon = () => {
    if (!selectedRibbon || draftSettings.ribbons.length <= 1) return;
    setDraftSettings((current) => {
      const ribbons = current.ribbons.filter((ribbon) => ribbon.id !== selectedRibbon.id);
      setSelectedRibbonId(ribbons[0]?.id ?? "");
      return { version: 1, ribbons };
    });
  };

  return (
    <div
      className="command-ribbon-settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <section
        className="command-ribbon-settings"
        role="dialog"
        aria-modal="true"
        aria-label="コマンドリボン設定"
      >
        <div className="shortcut-overlay-header">
          <div>
            <h2>コマンドリボン</h2>
            <p>Canvas上に固定表示するコマンドボタン</p>
          </div>
          <button type="button" onClick={close}>閉じる</button>
        </div>

        <div className="command-ribbon-settings-body">
          <aside className="command-ribbon-settings-sidebar">
            <div className="command-ribbon-settings-actions">
              <button type="button" onClick={addRibbon}>追加</button>
              <button type="button" disabled={!selectedRibbon} onClick={duplicateRibbon}>複製</button>
              <button
                type="button"
                disabled={!selectedRibbon || draftSettings.ribbons.length <= 1}
                onClick={deleteRibbon}
              >
                削除
              </button>
            </div>
            <div className="command-ribbon-settings-tabs" role="listbox" aria-label="リボン">
              {draftSettings.ribbons.map((ribbon) => (
                <button
                  key={ribbon.id}
                  type="button"
                  className={ribbon.id === selectedRibbon?.id ? "selected" : ""}
                  aria-selected={ribbon.id === selectedRibbon?.id}
                  onClick={() => selectRibbon(ribbon.id)}
                >
                  <span>{ribbon.label}</span>
                  <small>{ribbon.orientation === "vertical" ? "縦" : "横"} / {ribbon.iconSize}px</small>
                </button>
              ))}
            </div>
          </aside>

          {selectedRibbon ? (
            <div className="command-ribbon-settings-editor">
              <div className="command-ribbon-settings-grid">
                <label>
                  名前
                  <input
                    value={selectedRibbon.label}
                    onChange={(event) =>
                      setDraftSettings((current) =>
                        withRibbon(current, selectedRibbon.id, (ribbon) => ({
                          ...ribbon,
                          label: event.target.value
                        }))
                      )
                    }
                  />
                </label>
                <label>
                  向き
                  <select
                    value={selectedRibbon.orientation}
                    onChange={(event) =>
                      setDraftSettings((current) =>
                        withRibbon(current, selectedRibbon.id, (ribbon) => ({
                          ...ribbon,
                          orientation: event.target.value === "vertical" ? "vertical" : "horizontal"
                        }))
                      )
                    }
                  >
                    <option value="horizontal">横</option>
                    <option value="vertical">縦</option>
                  </select>
                </label>
                <label>
                  アイコンサイズ
                  <select
                    value={selectedRibbon.iconSize}
                    onChange={(event) =>
                      setDraftSettings((current) =>
                        withRibbon(current, selectedRibbon.id, (ribbon) => ({
                          ...ribbon,
                          iconSize: Number(event.target.value) as CommandRibbonIconSize
                        }))
                      )
                    }
                  >
                    {commandRibbonIconSizes.map((size) => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="command-ribbon-command-filter">
                <input
                  value={commandQuery}
                  placeholder="コマンドを絞り込み"
                  aria-label="リボンに追加するコマンドを絞り込み"
                  onChange={(event) => setCommandQuery(event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => {
                    const commandId = filteredCommands[0]?.commandId ?? firstCommandId;
                    setDraftSettings((current) =>
                      withRibbon(current, selectedRibbon.id, (ribbon) => ({
                        ...ribbon,
                        buttons: [
                          ...ribbon.buttons,
                          {
                            ...defaultButton(),
                            commandId,
                            label: commandLabel(commandId)
                          }
                        ]
                      }))
                    );
                  }}
                >
                  ボタン追加
                </button>
              </div>

              <div className="command-ribbon-button-list">
                {selectedRibbon.buttons.map((button) => (
                  <div className="command-ribbon-button-row" key={button.id}>
                    <label>
                      コマンド
                      <select
                        value={button.commandId}
                        onChange={(event) => {
                          const commandId = event.target.value as CommandId;
                          setDraftSettings((current) =>
                            withButton(current, selectedRibbon.id, button.id, (item) => ({
                              ...item,
                              commandId,
                              label: commandLabel(commandId)
                            }))
                          );
                        }}
                      >
                        {commandOptionsForButton(button).map((item) => (
                          <option key={item.commandId} value={item.commandId}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      アイコン
                      <select
                        value={button.icon}
                        onChange={(event) =>
                          setDraftSettings((current) =>
                            withButton(current, selectedRibbon.id, button.id, (item) => ({
                              ...item,
                              icon: event.target.value as CommandRibbonIconId
                            }))
                          )
                        }
                      >
                        {commandRibbonIconIds.map((iconId) => (
                          <option key={iconId} value={iconId}>{commandRibbonIconLabels[iconId]}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      ラベル
                      <input
                        value={button.label}
                        onChange={(event) =>
                          setDraftSettings((current) =>
                            withButton(current, selectedRibbon.id, button.id, (item) => ({
                              ...item,
                              label: event.target.value
                            }))
                          )
                        }
                      />
                    </label>
                    <label className="command-ribbon-label-toggle">
                      <input
                        type="checkbox"
                        checked={button.showLabel}
                        onChange={(event) =>
                          setDraftSettings((current) =>
                            withButton(current, selectedRibbon.id, button.id, (item) => ({
                              ...item,
                              showLabel: event.target.checked
                            }))
                          )
                        }
                      />
                      表示
                    </label>
                    <div className="command-ribbon-icon-preview" aria-hidden="true">
                      {(() => {
                        const Icon = commandRibbonIconComponents[button.icon];
                        return <Icon size={selectedRibbon.iconSize} strokeWidth={2} />;
                      })()}
                    </div>
                    <button
                      type="button"
                      disabled={selectedRibbon.buttons.length <= 1}
                      onClick={() =>
                        setDraftSettings((current) =>
                          withRibbon(current, selectedRibbon.id, (ribbon) => ({
                            ...ribbon,
                            buttons: ribbon.buttons.filter((item) => item.id !== button.id)
                          }))
                        )
                      }
                    >
                      削除
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="command-ribbon-settings-footer">
          {commandRibbonSettingsError ? (
            <p className="shortcut-settings-error" role="alert">{commandRibbonSettingsError}</p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              const defaults = defaultCommandRibbonSettings();
              setDraftSettings(defaults);
              setSelectedRibbonId(defaults.ribbons[0]?.id ?? "");
            }}
          >
            初期値
          </button>
          <button type="button" onClick={close}>キャンセル</button>
          <button
            type="button"
            disabled={commandRibbonSettingsLoading || !hasChanges}
            onClick={saveSettings}
          >
            {commandRibbonSettingsLoading ? "保存中..." : "保存"}
          </button>
        </div>
      </section>
    </div>
  );
};
