use tauri::{
    menu::{Menu, MenuBuilder, MenuItem, Submenu, SubmenuBuilder},
    AppHandle, Wry,
};

pub const MENU_COMMAND_EVENT: &str = "nuinuicad://menu-command";

const MENU_COMMAND_PREFIX: &str = "command:";

type AppMenu = Menu<Wry>;
type AppMenuItem = MenuItem<Wry>;
type AppSubmenu = Submenu<Wry>;
type AppSubmenuBuilder<'a> = SubmenuBuilder<'a, Wry, AppHandle<Wry>>;

#[derive(Clone, Copy)]
struct CommandSpec {
    id: &'static str,
    label: &'static str,
    accelerator: Option<&'static str>,
}

#[derive(Clone, Copy)]
enum NativeSpec {
    #[cfg(target_os = "macos")]
    About,
    #[cfg(target_os = "macos")]
    Hide,
    #[cfg(target_os = "macos")]
    HideOthers,
    #[cfg(target_os = "macos")]
    ShowAll,
    #[cfg(target_os = "macos")]
    Quit,
    #[cfg(target_os = "macos")]
    Minimize,
    #[cfg(target_os = "macos")]
    Fullscreen,
    #[cfg(target_os = "macos")]
    CloseWindow,
}

#[derive(Clone, Copy)]
enum MenuSpec {
    Command(CommandSpec),
    Native(NativeSpec),
    Separator,
}

const fn cmd(id: &'static str, label: &'static str, accelerator: Option<&'static str>) -> MenuSpec {
    MenuSpec::Command(CommandSpec {
        id,
        label,
        accelerator,
    })
}

const fn native(item: NativeSpec) -> MenuSpec {
    MenuSpec::Native(item)
}

const SEP: MenuSpec = MenuSpec::Separator;
const CAD_ACTION_MENU_TITLE: &str = "操作";

#[cfg(target_os = "macos")]
const APP_ITEMS: &[MenuSpec] = &[
    native(NativeSpec::About),
    SEP,
    native(NativeSpec::Hide),
    native(NativeSpec::HideOthers),
    native(NativeSpec::ShowAll),
    SEP,
    native(NativeSpec::Quit),
];

const FILE_ITEMS: &[MenuSpec] = &[
    cmd("newDocument", "新規ドキュメント", Some("CmdOrCtrl+N")),
    cmd("openDocument", "開く...", Some("CmdOrCtrl+O")),
    SEP,
    cmd("saveDocument", "保存", Some("CmdOrCtrl+S")),
    cmd(
        "saveDocumentAs",
        "名前を付けて保存...",
        Some("CmdOrCtrl+Shift+S"),
    ),
    SEP,
    cmd("exportPrintSvg", "SVGを書き出す...", None),
    cmd("exportPrintPdf", "印刷用PDFを書き出す...", None),
];

const EDIT_ITEMS: &[MenuSpec] = &[
    cmd("undo", "元に戻す", Some("CmdOrCtrl+Z")),
    cmd("redo", "やり直す", Some("CmdOrCtrl+Y")),
    SEP,
    cmd(
        "duplicateSelectedElement",
        "選択要素を複製",
        Some("CmdOrCtrl+D"),
    ),
    cmd("deleteSelectedElement", "選択要素を削除", None),
    SEP,
    cmd("toggleSelectedElementVisibility", "表示/非表示を切替", None),
    cmd(
        "toggleSelectedElementEnabled",
        "評価する/しないを切替",
        None,
    ),
    SEP,
    cmd(
        "groupSelectedElements",
        "選択要素をグループ化",
        Some("CmdOrCtrl+G"),
    ),
    cmd("addConditionalGroup", "ifブロックを追加", Some("Alt+I")),
    cmd(
        "wrapSelectedElementsInConditionalGroup",
        "選択範囲をifで囲む",
        Some("Shift+Alt+I"),
    ),
    cmd(
        "addElseBranchToSelectedConditionalGroup",
        "else枝を追加",
        None,
    ),
    cmd(
        "deleteElseBranchFromSelectedConditionalGroup",
        "else枝を削除",
        None,
    ),
    cmd(
        "ungroupSelectedGroup",
        "選択グループを解除",
        Some("CmdOrCtrl+Shift+G"),
    ),
    cmd("indentSelectedElements", "選択要素をインデント", None),
    cmd("outdentSelectedElements", "選択要素をアウトデント", None),
];

const DRAW_ITEMS: &[MenuSpec] = &[
    cmd("addFreePoint", "free point を追加", None),
    cmd("addOffsetPoint", "offset point を追加", None),
    cmd("addPolarOffsetPoint", "polar offset point を追加", None),
    cmd("addDivisionPoint", "点間分点を追加", None),
    cmd("addLineDivisionPoint", "線上分点を追加", None),
    cmd("addIntersectionPoint", "交点を追加", None),
    cmd("addLineTangentOffsetPoint", "線上オフセット点を追加", None),
    SEP,
    cmd("addLine", "line を追加", None),
    cmd("addArcLine", "円弧線を追加", None),
    cmd("addThreePointArcLine", "三点円弧線を追加", None),
    cmd("addCornerRadiusArcLine", "角R円弧線を追加", Some("Shift+R")),
    cmd("addBezierCurve", "Bezier curve を追加", None),
    SEP,
    cmd("addEdge", "エッジを追加", None),
    cmd("addExtendTrim", "延長短縮を追加", None),
    cmd("addOffsetLine", "オフセット線を追加", Some("Shift+O")),
    cmd("addSplitLine", "分割線を追加", None),
    cmd("addCopyLine", "コピー線を追加", Some("Shift+C")),
    cmd("addSymmetricCopyLine", "対称コピー線を追加", None),
    cmd("addMove", "移動を追加", None),
    cmd("addSymmetricMove", "対称移動を追加", None),
    SEP,
    cmd("addVariable", "変数を追加", None),
    cmd("addNumericVariable", "要素内変数を追加", None),
    cmd("addBezierIntermediatePoint", "曲線の中間点を追加", None),
];

const VIEW_ITEMS: &[MenuSpec] = &[
    cmd("zoomInCanvas", "キャンバスを拡大", None),
    cmd("zoomOutCanvas", "キャンバスを縮小", None),
    cmd("resetCanvasView", "キャンバス表示をリセット", None),
    SEP,
    cmd("openPrintLayout", "印刷レイアウトを開く", None),
    cmd("closePrintLayout", "CAD編集に戻る", None),
    SEP,
    cmd("toggleElementInfoPanel", "要素詳細を表示/非表示", None),
    cmd("openCommandPalette", "コマンドパレットを開く", None),
    cmd(
        "toggleShortcutHelp",
        "ショートカット一覧を表示/非表示",
        None,
    ),
    cmd("openShortcutSettings", "ショートカット設定を開く", None),
];

const NAVIGATE_ITEMS: &[MenuSpec] = &[
    cmd("focusCanvas", "キャンバスへフォーカス", None),
    cmd("focusElementList", "要素リストへフォーカス", None),
    cmd(
        "focusElementSearch",
        "要素検索へフォーカス",
        Some("CmdOrCtrl+F"),
    ),
    SEP,
    cmd("selectPreviousElement", "前の要素を選択", None),
    cmd("selectNextElement", "次の要素を選択", None),
    cmd("selectParentGroup", "親グループを選択", None),
    cmd(
        "enterParameterEditMode",
        "パラメーター編集モードに入る",
        None,
    ),
    cmd(
        "enterDependencyJumpMode",
        "親子要素ジャンプモードに入る",
        None,
    ),
    SEP,
    cmd(
        "moveSelectedElementUp",
        "選択要素を上へ",
        Some("CmdOrCtrl+Up"),
    ),
    cmd(
        "moveSelectedElementDown",
        "選択要素を下へ",
        Some("CmdOrCtrl+Down"),
    ),
    cmd(
        "moveEvaluationDividerUp",
        "評価区切り線を上へ",
        Some("Shift+Alt+Up"),
    ),
    cmd(
        "moveEvaluationDividerDown",
        "評価区切り線を下へ",
        Some("Shift+Alt+Down"),
    ),
    cmd(
        "moveEvaluationDividerToSelectedElement",
        "評価区切り線を選択要素の下へ",
        None,
    ),
    cmd("moveEvaluationDividerToEnd", "評価区切り線を末尾へ", None),
];

#[cfg(target_os = "macos")]
const WINDOW_ITEMS: &[MenuSpec] = &[
    native(NativeSpec::Minimize),
    native(NativeSpec::Fullscreen),
    SEP,
    native(NativeSpec::CloseWindow),
];

pub fn command_id_from_menu_id(menu_id: &str) -> Option<&str> {
    menu_id
        .strip_prefix(MENU_COMMAND_PREFIX)
        .filter(|command_id| !command_id.is_empty())
}

fn command_menu_id(command_id: &str) -> String {
    format!("{MENU_COMMAND_PREFIX}{command_id}")
}

fn command_item(app: &AppHandle<Wry>, spec: CommandSpec) -> tauri::Result<AppMenuItem> {
    MenuItem::with_id(
        app,
        command_menu_id(spec.id),
        spec.label,
        true,
        spec.accelerator,
    )
}

fn add_item<'a>(
    builder: AppSubmenuBuilder<'a>,
    app: &'a AppHandle<Wry>,
    spec: MenuSpec,
) -> tauri::Result<AppSubmenuBuilder<'a>> {
    match spec {
        MenuSpec::Command(command) => {
            let item = command_item(app, command)?;
            Ok(builder.item(&item))
        }
        MenuSpec::Native(native_item) => Ok(match native_item {
            #[cfg(target_os = "macos")]
            NativeSpec::About => builder.about(None),
            #[cfg(target_os = "macos")]
            NativeSpec::Hide => builder.hide(),
            #[cfg(target_os = "macos")]
            NativeSpec::HideOthers => builder.hide_others(),
            #[cfg(target_os = "macos")]
            NativeSpec::ShowAll => builder.show_all(),
            #[cfg(target_os = "macos")]
            NativeSpec::Quit => builder.quit(),
            #[cfg(target_os = "macos")]
            NativeSpec::Minimize => builder.minimize(),
            #[cfg(target_os = "macos")]
            NativeSpec::Fullscreen => builder.fullscreen(),
            #[cfg(target_os = "macos")]
            NativeSpec::CloseWindow => builder.close_window(),
        }),
        MenuSpec::Separator => Ok(builder.separator()),
    }
}

fn build_submenu(
    app: &AppHandle<Wry>,
    title: &'static str,
    items: &[MenuSpec],
) -> tauri::Result<AppSubmenu> {
    let mut builder = SubmenuBuilder::new(app, title);
    for item in items {
        builder = add_item(builder, app, *item)?;
    }
    builder.build()
}

pub fn build_app_menu(app: &AppHandle<Wry>) -> tauri::Result<AppMenu> {
    let mut builder = MenuBuilder::new(app);

    #[cfg(target_os = "macos")]
    {
        let app_menu = build_submenu(app, "nuinuiCAD", APP_ITEMS)?;
        builder = builder.item(&app_menu);
    }

    for (title, items) in [
        ("ファイル", FILE_ITEMS),
        (CAD_ACTION_MENU_TITLE, EDIT_ITEMS),
        ("作図", DRAW_ITEMS),
        ("表示", VIEW_ITEMS),
        ("移動", NAVIGATE_ITEMS),
    ] {
        let submenu = build_submenu(app, title, items)?;
        builder = builder.item(&submenu);
    }

    #[cfg(target_os = "macos")]
    {
        let window_menu = build_submenu(app, "ウインドウ", WINDOW_ITEMS)?;
        builder = builder.item(&window_menu);
    }

    builder.build()
}

#[cfg(test)]
mod tests {
    use super::{command_id_from_menu_id, MenuSpec, NativeSpec, CAD_ACTION_MENU_TITLE, EDIT_ITEMS};

    #[test]
    fn extracts_command_id_from_menu_id() {
        assert_eq!(
            command_id_from_menu_id("command:openDocument"),
            Some("openDocument")
        );
        assert_eq!(command_id_from_menu_id("command:"), None);
        assert_eq!(command_id_from_menu_id("quit"), None);
    }

    #[test]
    fn edit_menu_contains_only_cad_commands_and_separators() {
        for item in EDIT_ITEMS {
            if let MenuSpec::Native(native_item) = item {
                match native_item {
                    #[cfg(target_os = "macos")]
                    NativeSpec::About
                    | NativeSpec::Hide
                    | NativeSpec::HideOthers
                    | NativeSpec::ShowAll
                    | NativeSpec::Quit
                    | NativeSpec::Minimize
                    | NativeSpec::Fullscreen
                    | NativeSpec::CloseWindow => {
                        panic!("edit menu should not contain native macOS items")
                    }
                }
            }
        }
    }

    #[test]
    fn cad_action_menu_does_not_use_the_standard_edit_title() {
        assert_eq!(CAD_ACTION_MENU_TITLE, "操作");
    }
}
