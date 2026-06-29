pub mod document_file;
pub mod evaluation;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            evaluation::evaluate_document,
            document_file::read_document_file,
            document_file::write_document_file
        ])
        .run(tauri::generate_context!())
        .expect("failed to run nuinuiCAD");
}
