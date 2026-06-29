use std::fs;

#[tauri::command]
pub fn read_document_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|error| format!("ドキュメントを読み込めません: {error}"))
}

#[tauri::command]
pub fn write_document_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|error| format!("ドキュメントを保存できません: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{read_document_file, write_document_file};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_path(file_name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("nuinuicad-{nonce}-{file_name}"))
    }

    #[test]
    fn writes_and_reads_document_content() {
        let path = test_path("document.nuinui.json");
        let path_string = path.to_string_lossy().to_string();

        write_document_file(path_string.clone(), "{\"app\":\"nuinuiCAD\"}\n".to_string())
            .expect("write should succeed");

        let content = read_document_file(path_string).expect("read should succeed");
        assert_eq!(content, "{\"app\":\"nuinuiCAD\"}\n");

        fs::remove_file(path).expect("test file should be removable");
    }

    #[test]
    fn returns_error_for_missing_document() {
        let path = test_path("missing.nuinui.json");
        let error = read_document_file(path.to_string_lossy().to_string())
            .expect_err("missing file should fail");

        assert!(error.contains("ドキュメントを読み込めません"));
    }

    #[test]
    fn returns_error_for_unwritable_path() {
        let path = test_path("missing-dir/document.nuinui.json");
        let error = write_document_file(path.to_string_lossy().to_string(), "{}".to_string())
            .expect_err("missing parent directory should fail");

        assert!(error.contains("ドキュメントを保存できません"));
    }
}
