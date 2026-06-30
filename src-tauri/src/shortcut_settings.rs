use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const SETTINGS_FILE_NAME: &str = "shortcut-settings.json";

fn default_shortcut_settings() -> Value {
    json!({
        "version": 1,
        "overrides": []
    })
}

fn shortcut_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(SETTINGS_FILE_NAME))
        .map_err(|error| format!("ショートカット設定の保存先を取得できません: {error}"))
}

fn load_shortcut_settings_from_path(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(default_shortcut_settings());
    }

    let content = fs::read_to_string(path)
        .map_err(|error| format!("ショートカット設定を読み込めません: {error}"))?;
    match serde_json::from_str(&content) {
        Ok(settings) => Ok(settings),
        Err(_) => Ok(default_shortcut_settings()),
    }
}

fn save_shortcut_settings_to_path(path: &Path, input: Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("ショートカット設定フォルダを作成できません: {error}"))?;
    }
    let content = serde_json::to_string_pretty(&input)
        .map_err(|error| format!("ショートカット設定をJSONに変換できません: {error}"))?;
    fs::write(path, format!("{content}\n"))
        .map_err(|error| format!("ショートカット設定を保存できません: {error}"))
}

#[tauri::command]
pub fn load_shortcut_settings(app: tauri::AppHandle) -> Result<Value, String> {
    load_shortcut_settings_from_path(&shortcut_settings_path(&app)?)
}

#[tauri::command]
pub fn save_shortcut_settings(app: tauri::AppHandle, input: Value) -> Result<(), String> {
    save_shortcut_settings_to_path(&shortcut_settings_path(&app)?, input)
}

#[cfg(test)]
mod tests {
    use super::{load_shortcut_settings_from_path, save_shortcut_settings_to_path};
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_path(file_name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nuinuicad-shortcuts-{nonce}"))
            .join(file_name)
    }

    #[test]
    fn returns_default_settings_for_missing_file() {
        let path = test_path("missing.json");
        let settings = load_shortcut_settings_from_path(&path).expect("missing file should load");

        assert_eq!(settings, json!({ "version": 1, "overrides": [] }));
    }

    #[test]
    fn saves_and_loads_shortcut_settings() {
        let path = test_path("shortcut-settings.json");
        let input = json!({
            "version": 1,
            "overrides": [
                {
                    "bindingId": "normal.addLine",
                    "chords": [{ "key": "l", "mod": false, "alt": false, "shift": true }]
                }
            ]
        });

        save_shortcut_settings_to_path(&path, input.clone()).expect("settings should save");
        let settings = load_shortcut_settings_from_path(&path).expect("settings should load");

        assert_eq!(settings, input);
        fs::remove_dir_all(path.parent().expect("path should have a parent"))
            .expect("test directory should be removable");
    }

    #[test]
    fn falls_back_to_default_settings_for_invalid_json() {
        let path = test_path("broken.json");
        fs::create_dir_all(path.parent().expect("path should have a parent"))
            .expect("test directory should be creatable");
        fs::write(&path, "{not-json").expect("broken json should be writable");

        let settings = load_shortcut_settings_from_path(&path).expect("broken file should load");

        assert_eq!(settings, json!({ "version": 1, "overrides": [] }));
        fs::remove_dir_all(path.parent().expect("path should have a parent"))
            .expect("test directory should be removable");
    }

    #[test]
    fn returns_error_for_unwritable_path() {
        let path = test_path("missing-parent").join("settings.json");
        let blocking_parent = path.parent().expect("path should have a parent");
        fs::create_dir_all(
            blocking_parent
                .parent()
                .expect("blocking parent should have a parent"),
        )
        .expect("test directory should be creatable");
        fs::write(blocking_parent, "not a directory").expect("blocking file should be writable");

        let error = save_shortcut_settings_to_path(&path, json!({ "version": 1, "overrides": [] }))
            .expect_err("file parent should fail");

        assert!(error.contains("ショートカット設定フォルダを作成できません"));
        fs::remove_file(path.parent().expect("path should have a parent"))
            .expect("blocking file should be removable");
    }
}
