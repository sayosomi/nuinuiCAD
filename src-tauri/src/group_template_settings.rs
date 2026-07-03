use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const SETTINGS_FILE_NAME: &str = "group-template-library.json";

fn default_group_template_library() -> Value {
    json!({
        "version": 1,
        "templates": []
    })
}

fn group_template_library_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("テンプレート設定フォルダを開けません: {error}"))?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("テンプレート設定フォルダを作成できません: {error}"))?;
    Ok(dir.join(SETTINGS_FILE_NAME))
}

fn load_group_template_library_from_path(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(default_group_template_library());
    }
    let content = fs::read_to_string(path)
        .map_err(|error| format!("テンプレート設定を読み込めません: {error}"))?;
    match serde_json::from_str::<Value>(&content) {
        Ok(value) => Ok(value),
        Err(_) => Ok(default_group_template_library()),
    }
}

fn save_group_template_library_to_path(path: &Path, input: Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("テンプレート設定フォルダを作成できません: {error}"))?;
    }
    let content = serde_json::to_string_pretty(&input)
        .map_err(|error| format!("テンプレート設定をJSONに変換できません: {error}"))?;
    fs::write(path, format!("{content}\n"))
        .map_err(|error| format!("テンプレート設定を保存できません: {error}"))
}

#[tauri::command]
pub fn load_group_template_library(app: tauri::AppHandle) -> Result<Value, String> {
    load_group_template_library_from_path(&group_template_library_path(&app)?)
}

#[tauri::command]
pub fn save_group_template_library(app: tauri::AppHandle, input: Value) -> Result<(), String> {
    save_group_template_library_to_path(&group_template_library_path(&app)?, input)
}

#[cfg(test)]
mod tests {
    use super::{load_group_template_library_from_path, save_group_template_library_to_path};
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_path(file_name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("nuinuicad-{nonce}-{file_name}"))
    }

    #[test]
    fn returns_default_library_for_missing_file() {
        let path = test_path("group-template-library.json");
        let settings =
            load_group_template_library_from_path(&path).expect("missing file should load");

        assert_eq!(settings["version"], 1);
        assert!(settings["templates"].as_array().unwrap().is_empty());
    }

    #[test]
    fn saves_and_loads_group_template_library() {
        let path = test_path("group-template-library.json");
        let input = json!({
            "version": 1,
            "templates": [{ "id": "template-1", "name": "袖" }]
        });

        save_group_template_library_to_path(&path, input.clone()).expect("settings should save");
        let settings = load_group_template_library_from_path(&path).expect("settings should load");

        assert_eq!(settings, input);
        fs::remove_file(path).expect("test file should be removable");
    }

    #[test]
    fn falls_back_to_default_library_for_invalid_json() {
        let path = test_path("broken-group-template-library.json");
        fs::write(&path, "{").expect("test file should be writable");

        let settings =
            load_group_template_library_from_path(&path).expect("broken file should load");

        assert_eq!(settings["version"], 1);
        assert!(settings["templates"].as_array().unwrap().is_empty());
        fs::remove_file(path).expect("test file should be removable");
    }
}
