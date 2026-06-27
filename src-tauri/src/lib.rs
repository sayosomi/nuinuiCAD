mod evaluation;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![evaluation::evaluate_document])
        .run(tauri::generate_context!())
        .expect("failed to run nuinuiCAD");
}
