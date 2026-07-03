import { useMemo, useState } from "react";
import { dispatchCommand, commandPaletteItems, commands, type CommandId } from "../commands/commands";
import {
  commandRibbonIconColorLabels,
  commandRibbonIconColors,
  commandRibbonIconColorValues,
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
  commandRibbonIconCatalog,
  commandRibbonIconCategoryLabels,
  commandRibbonIconComponents,
  type CommandRibbonIconId
} from "../commandRibbons/commandRibbonIcons";
import { useCadUiStore } from "../state/cadUiStore";
import { isImeComposingKeyEvent } from "./keyboardEventGuards";

const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const firstCommandId = commandPaletteItems[0]?.commandId ?? "addLine";

const commandLabel = (commandId: CommandId) => commands[commandId]?.label ?? commandId;

const defaultButton = (): CommandRibbonButton => ({
  id: newId("button"),
  commandId: firstCommandId,
  icon: "slash",
  iconColor: "default",
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

const iconSearchText = (icon: (typeof commandRibbonIconCatalog)[number]) =>
  `${icon.label} ${icon.id} ${icon.category} ${icon.keywords.join(" ")}`.toLowerCase();

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

const moveItem = <T,>(items: T[], index: number, direction: -1 | 1) => {
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return items;
  const nextItems = [...items];
  [nextItems[index], nextItems[nextIndex]] = [nextItems[nextIndex], nextItems[index]];
  return nextItems;
};

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
  const [selectedButtonId, setSelectedButtonId] = useState(draftSettings.ribbons[0]?.buttons[0]?.id ?? "");
  const [commandQuery, setCommandQuery] = useState("");
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [iconQuery, setIconQuery] = useState("");
  const selectedRibbon =
    draftSettings.ribbons.find((ribbon) => ribbon.id === selectedRibbonId) ??
    draftSettings.ribbons[0] ??
    null;
  const selectedButton =
    selectedRibbon?.buttons.find((button) => button.id === selectedButtonId) ??
    selectedRibbon?.buttons[0] ??
    null;
  const hasChanges = JSON.stringify(commandRibbonSettings) !== JSON.stringify(draftSettings);
  const filteredCommands = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) return commandPaletteItems;
    return commandPaletteItems.filter((item) => commandSearchText(item.commandId).includes(query));
  }, [commandQuery]);
  const commandCandidates = filteredCommands;
  const visibleCommandCandidates = commandCandidates.slice(0, 24);
  const clampedCommandIndex = Math.min(
    selectedCommandIndex,
    Math.max(visibleCommandCandidates.length - 1, 0)
  );
  const selectedCommandCandidate = visibleCommandCandidates[clampedCommandIndex] ?? null;
  const filteredIcons = useMemo(() => {
    const query = iconQuery.trim().toLowerCase();
    if (!query) return commandRibbonIconCatalog;
    return commandRibbonIconCatalog.filter((icon) => iconSearchText(icon).includes(query));
  }, [iconQuery]);

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

  const selectRibbon = (ribbonId: string) => {
    const ribbon = draftSettings.ribbons.find((item) => item.id === ribbonId);
    setSelectedRibbonId(ribbonId);
    setSelectedButtonId(ribbon?.buttons[0]?.id ?? "");
  };

  const addRibbon = () => {
    setDraftSettings((current) => {
      const ribbon = defaultRibbon(current.ribbons.length);
      setSelectedRibbonId(ribbon.id);
      setSelectedButtonId(ribbon.buttons[0]?.id ?? "");
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
    setSelectedButtonId(duplicate.buttons[0]?.id ?? "");
  };

  const deleteRibbon = () => {
    if (!selectedRibbon || draftSettings.ribbons.length <= 1) return;
    setDraftSettings((current) => {
      const ribbons = current.ribbons.filter((ribbon) => ribbon.id !== selectedRibbon.id);
      setSelectedRibbonId(ribbons[0]?.id ?? "");
      setSelectedButtonId(ribbons[0]?.buttons[0]?.id ?? "");
      return { version: 1, ribbons };
    });
  };

  const moveRibbon = (ribbonId: string, direction: -1 | 1) => {
    setDraftSettings((current) => ({
      version: 1,
      ribbons: moveItem(
        current.ribbons,
        current.ribbons.findIndex((ribbon) => ribbon.id === ribbonId),
        direction
      )
    }));
  };

  const moveButton = (buttonId: string, direction: -1 | 1) => {
    if (!selectedRibbon) return;
    setDraftSettings((current) =>
      withRibbon(current, selectedRibbon.id, (ribbon) => ({
        ...ribbon,
        buttons: moveItem(
          ribbon.buttons,
          ribbon.buttons.findIndex((button) => button.id === buttonId),
          direction
        )
      }))
    );
  };

  const applyCommandToSelectedButton = (commandId: CommandId) => {
    if (!selectedRibbon || !selectedButton) return;
    setDraftSettings((current) =>
      withButton(current, selectedRibbon.id, selectedButton.id, (button) => ({
        ...button,
        commandId,
        label: commandLabel(commandId)
      }))
    );
  };

  const addButtonForCommand = (commandId: CommandId) => {
    if (!selectedRibbon) return;
    const buttonId = newId("button");
    setDraftSettings((current) =>
      withRibbon(current, selectedRibbon.id, (ribbon) => ({
        ...ribbon,
        buttons: [
          ...ribbon.buttons,
          {
            ...defaultButton(),
            id: buttonId,
            commandId,
            label: commandLabel(commandId)
          }
        ]
      }))
    );
    setSelectedButtonId(buttonId);
  };

  const applyIconToSelectedButton = (icon: CommandRibbonIconId) => {
    if (!selectedRibbon || !selectedButton) return;
    setDraftSettings((current) =>
      withButton(current, selectedRibbon.id, selectedButton.id, (button) => ({
        ...button,
        icon
      }))
    );
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
              {draftSettings.ribbons.map((ribbon, index) => (
                <div
                  className={`command-ribbon-settings-tab ${ribbon.id === selectedRibbon?.id ? "selected" : ""}`}
                  key={ribbon.id}
                >
                  <button
                    type="button"
                    aria-selected={ribbon.id === selectedRibbon?.id}
                    onClick={() => selectRibbon(ribbon.id)}
                  >
                    <span>{ribbon.label}</span>
                    <small>{ribbon.orientation === "vertical" ? "縦" : "横"} / {ribbon.iconSize}px</small>
                  </button>
                  <div className="command-ribbon-order-buttons">
                    <button
                      type="button"
                      aria-label={`${ribbon.label}を上へ`}
                      disabled={index === 0}
                      onClick={() => {
                        selectRibbon(ribbon.id);
                        moveRibbon(ribbon.id, -1);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`${ribbon.label}を下へ`}
                      disabled={index === draftSettings.ribbons.length - 1}
                      onClick={() => {
                        selectRibbon(ribbon.id);
                        moveRibbon(ribbon.id, 1);
                      }}
                    >
                      ↓
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {selectedRibbon ? (
            <>
              <div className="command-ribbon-settings-workspace">
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

                <div className="command-ribbon-draft-preview" aria-label="リボンプレビュー">
                  <div className={`command-ribbon-preview is-${selectedRibbon.orientation}`}>
                    {selectedRibbon.buttons.map((button) => {
                      const Icon = commandRibbonIconComponents[button.icon];
                      return (
                        <span
                          className={button.id === selectedButton?.id ? "selected" : ""}
                          key={button.id}
                        >
                          <Icon
                            size={selectedRibbon.iconSize}
                            strokeWidth={2}
                            style={{ color: commandRibbonIconColorValues[button.iconColor] }}
                          />
                          {button.showLabel ? <em>{button.label}</em> : null}
                        </span>
                      );
                    })}
                  </div>
                </div>

                <div className="command-ribbon-command-panel">
                  <div className="command-ribbon-command-filter">
                    <input
                      value={commandQuery}
                      placeholder="コマンドを検索"
                      aria-label="コマンドを検索"
                      onChange={(event) => {
                        setCommandQuery(event.target.value);
                        setSelectedCommandIndex(0);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          setSelectedCommandIndex((index) =>
                            Math.min(index + 1, Math.max(visibleCommandCandidates.length - 1, 0))
                          );
                          return;
                        }

                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          setSelectedCommandIndex((index) => Math.max(index - 1, 0));
                          return;
                        }

                        if (event.key === "Enter") {
                          if (isImeComposingKeyEvent(event)) return;
                          event.preventDefault();
                          if (selectedCommandCandidate) {
                            applyCommandToSelectedButton(selectedCommandCandidate.commandId);
                          }
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => addButtonForCommand(filteredCommands[0]?.commandId ?? firstCommandId)}
                    >
                      先頭候補を追加
                    </button>
                  </div>
                  <div
                    className="command-ribbon-command-candidates command-palette-list"
                    role="listbox"
                    aria-label="コマンド候補"
                  >
                    {visibleCommandCandidates.length === 0 ? (
                      <p className="command-palette-empty">該当するコマンドはありません。</p>
                    ) : (
                      visibleCommandCandidates.map((item, index) => (
                        <div
                          key={item.commandId}
                          className="command-ribbon-command-candidate-row"
                          onMouseEnter={() => setSelectedCommandIndex(index)}
                        >
                          <button
                            type="button"
                            className={`command-palette-item ${index === clampedCommandIndex ? "selected" : ""}`}
                            role="option"
                            aria-selected={index === clampedCommandIndex}
                            aria-label={`${item.label}を適用`}
                            onClick={() => applyCommandToSelectedButton(item.commandId)}
                          >
                            <span>{item.label}</span>
                            <kbd>{item.commandId}</kbd>
                          </button>
                          <button
                            type="button"
                            className="command-ribbon-command-add-button"
                            aria-label={`${item.label}を追加`}
                            onClick={() => addButtonForCommand(item.commandId)}
                          >
                            +
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="command-ribbon-button-list" aria-label="リボンボタン">
                  {selectedRibbon.buttons.map((button, index) => {
                    const Icon = commandRibbonIconComponents[button.icon];
                    return (
                      <div
                        className={`command-ribbon-button-row ${button.id === selectedButton?.id ? "selected" : ""}`}
                        key={button.id}
                      >
                        <button
                          type="button"
                          className="command-ribbon-button-select"
                          onClick={() => setSelectedButtonId(button.id)}
                        >
                          <Icon
                            size={selectedRibbon.iconSize}
                            strokeWidth={2}
                            style={{ color: commandRibbonIconColorValues[button.iconColor] }}
                          />
                          <span>{commandLabel(button.commandId)}</span>
                          <small>{button.commandId}</small>
                        </button>
                        <span className="command-ribbon-button-row-label">{button.label}</span>
                        <span className="command-ribbon-button-row-state">
                          {button.showLabel ? "表示" : "非表示"}
                        </span>
                        <div className="command-ribbon-order-buttons">
                          <button
                            type="button"
                            aria-label={`${button.label}を前へ`}
                            disabled={index === 0}
                            onClick={() => {
                              setSelectedButtonId(button.id);
                              moveButton(button.id, -1);
                            }}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label={`${button.label}を後へ`}
                            disabled={index === selectedRibbon.buttons.length - 1}
                            onClick={() => {
                              setSelectedButtonId(button.id);
                              moveButton(button.id, 1);
                            }}
                          >
                            ↓
                          </button>
                        </div>
                        <button
                          type="button"
                          disabled={selectedRibbon.buttons.length <= 1}
                          onClick={() =>
                            setDraftSettings((current) => {
                              const nextButtons = selectedRibbon.buttons.filter((item) => item.id !== button.id);
                              setSelectedButtonId(nextButtons[0]?.id ?? "");
                              return withRibbon(current, selectedRibbon.id, (ribbon) => ({
                                ...ribbon,
                                buttons: ribbon.buttons.filter((item) => item.id !== button.id)
                              }));
                            })
                          }
                        >
                          削除
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <aside className="command-ribbon-settings-inspector" aria-label="ボタン詳細">
                {selectedButton ? (
                  <>
                    <div className="command-ribbon-button-picker-header">
                      <strong>選択中: {selectedButton.label}</strong>
                      <span>{selectedButton.commandId}</span>
                    </div>
                    <div className="command-ribbon-button-fields">
                      <label>
                        表示名
                        <input
                          value={selectedButton.label}
                          onChange={(event) =>
                            setDraftSettings((current) =>
                              withButton(current, selectedRibbon.id, selectedButton.id, (button) => ({
                                ...button,
                                label: event.target.value
                              }))
                            )
                          }
                        />
                      </label>
                      <label className="command-ribbon-label-toggle">
                        <input
                          type="checkbox"
                          checked={selectedButton.showLabel}
                          onChange={(event) =>
                            setDraftSettings((current) =>
                              withButton(current, selectedRibbon.id, selectedButton.id, (button) => ({
                                ...button,
                                showLabel: event.target.checked
                              }))
                            )
                          }
                        />
                        リボンに表示
                      </label>
                      <label>
                        アイコン色
                        <select
                          value={selectedButton.iconColor}
                          aria-label="アイコン色"
                          onChange={(event) =>
                            setDraftSettings((current) =>
                              withButton(current, selectedRibbon.id, selectedButton.id, (button) => ({
                                ...button,
                                iconColor: event.target.value as CommandRibbonButton["iconColor"]
                              }))
                            )
                          }
                        >
                          {commandRibbonIconColors.map((color) => (
                            <option key={color} value={color}>{commandRibbonIconColorLabels[color]}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="command-ribbon-icon-tools">
                      <input
                        value={iconQuery}
                        placeholder="アイコンを検索"
                        aria-label="アイコンを検索"
                        onChange={(event) => setIconQuery(event.target.value)}
                      />
                    </div>
                    <div className="command-ribbon-icon-grid" aria-label="アイコン候補">
                      {filteredIcons.length === 0 ? (
                        <p>該当するアイコンはありません。</p>
                      ) : (
                        Object.entries(commandRibbonIconCategoryLabels).map(([category, categoryLabel]) => {
                          const categoryIcons = filteredIcons.filter((icon) => icon.category === category);
                          if (categoryIcons.length === 0) return null;
                          return (
                            <section key={category} className="command-ribbon-icon-category">
                              <h3>{categoryLabel}</h3>
                              <div>
                                {categoryIcons.map((icon) => {
                                  const Icon = commandRibbonIconComponents[icon.id];
                                  return (
                                    <button
                                      type="button"
                                      key={icon.id}
                                      className={icon.id === selectedButton.icon ? "selected" : ""}
                                      aria-label={`${icon.label} アイコン`}
                                      title={`${icon.label} / ${icon.id}`}
                                      onClick={() => applyIconToSelectedButton(icon.id)}
                                    >
                                      <Icon
                                        size={selectedRibbon.iconSize}
                                        strokeWidth={2}
                                        style={{ color: commandRibbonIconColorValues[selectedButton.iconColor] }}
                                      />
                                    </button>
                                  );
                                })}
                              </div>
                            </section>
                          );
                        })
                      )}
                    </div>
                  </>
                ) : (
                  <p className="command-ribbon-empty-state">編集するボタンを選択してください。</p>
                )}
              </aside>
            </>
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
