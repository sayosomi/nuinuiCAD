use nuinuicad_rust_evaluator::{
    evaluate_document, export_output, EvaluationInput, EvaluationPayload, ExportOutputInput,
};
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};

#[derive(Debug, Deserialize)]
struct EvaluationRequest {
    id: u64,
    input: EvaluationInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutputExportRequest {
    id: u64,
    export_output: ExportOutputInput,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum NativeRequest {
    Evaluation(Box<EvaluationRequest>),
    OutputExport(OutputExportRequest),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputExportPayload {
    exported: bool,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum EvaluationResponse {
    Success {
        id: u64,
        payload: Box<EvaluationPayload>,
    },
    OutputExportSuccess {
        id: u64,
        payload: OutputExportPayload,
    },
    Error {
        id: u64,
        error: String,
    },
}

fn process_request_line(line: &str) -> Result<String, serde_json::Error> {
    let request: NativeRequest = serde_json::from_str(line)?;
    let response = match request {
        NativeRequest::Evaluation(request) => match evaluate_document(request.input) {
            Ok(payload) => EvaluationResponse::Success {
                id: request.id,
                payload: Box::new(payload),
            },
            Err(error) => EvaluationResponse::Error {
                id: request.id,
                error: error.to_string(),
            },
        },
        NativeRequest::OutputExport(request) => match export_output(request.export_output) {
            Ok(()) => EvaluationResponse::OutputExportSuccess {
                id: request.id,
                payload: OutputExportPayload { exported: true },
            },
            Err(error) => EvaluationResponse::Error {
                id: request.id,
                error,
            },
        },
    };
    Ok(serde_json::to_string(&response).expect("evaluation response must serialize"))
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) if !line.trim().is_empty() => line,
            Ok(_) => continue,
            Err(error) => {
                eprintln!("evaluation stdio read error: {error}");
                break;
            }
        };

        match process_request_line(&line) {
            Ok(response) => {
                if let Err(error) = writeln!(stdout, "{response}").and_then(|_| stdout.flush()) {
                    eprintln!("evaluation stdio write error: {error}");
                    break;
                }
            }
            Err(error) => eprintln!("evaluation stdio request error: {error}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::process_request_line;
    use serde_json::Value;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn request(id: u64, input: Value) -> String {
        serde_json::json!({ "id": id, "input": input }).to_string()
    }

    fn svg_export_request(id: u64, path: &str, width_mm: f64) -> String {
        serde_json::json!({
            "id": id,
            "exportOutput": {
                "path": path,
                "payload": {
                    "version": 1,
                    "kind": "svg",
                    "bounds": { "minX": 0.0, "minY": 0.0, "maxX": 10.0, "maxY": 10.0, "width": 10.0, "height": 10.0 },
                    "drawables": [{
                        "kind": "line",
                        "elementId": "line",
                        "name": "line",
                        "start": { "x": 0.0, "y": 0.0 },
                        "end": { "x": 10.0, "y": 10.0 },
                        "stroke": { "widthMm": 0.18, "style": "solid", "colorHex": "#31322f" }
                    }],
                    "widthMm": width_mm,
                    "heightMm": 10.0,
                    "contentOrigin": { "x": 0.0, "y": 0.0 }
                }
            }
        }).to_string()
    }

    fn unsupported_pdf_text_export_request(id: u64, path: &str) -> String {
        serde_json::json!({
            "id": id,
            "exportOutput": {
                "path": path,
                "payload": {
                    "version": 1,
                    "kind": "print",
                    "bounds": { "minX": 0.0, "minY": 0.0, "maxX": 4.0, "maxY": 4.0, "width": 4.0, "height": 4.0 },
                    "drawables": [{
                        "kind": "text",
                        "elementId": "text",
                        "name": "text",
                        "text": "😀",
                        "anchor": { "x": 0.0, "y": 0.0 },
                        "fontSizeMm": 4.0,
                        "widthMm": 4.0,
                        "lineWidthsMm": [4.0],
                        "lineAdvancesMm": [[4.0]],
                        "lineHeightMm": 4.8,
                        "rotationDeg": 0.0,
                        "mirrorX": false,
                        "colorHex": "#31322f"
                    }],
                    "paper": { "widthMm": 210.0, "heightMm": 297.0 },
                    "overlapMm": 0.0,
                    "stride": { "x": 210.0, "y": 297.0 },
                    "pages": [{
                        "index": 0,
                        "column": 0,
                        "row": 0,
                        "origin": { "x": 0.0, "y": 0.0 },
                        "guides": []
                    }]
                }
            }
        })
        .to_string()
    }

    fn temporary_export_path(label: &str) -> String {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nuinuicad-{label}-{nonce}.svg"))
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn returns_success_with_the_request_id_and_existing_payload() {
        let response = process_request_line(&request(7, serde_json::json!({ "elements": [] })))
            .expect("success response");
        let value: Value = serde_json::from_str(&response).expect("valid response JSON");
        assert_eq!(value["id"], 7);
        assert!(value["payload"].is_object());
        assert!(value["payload"]["computedGeometry"].is_array());
    }

    #[test]
    fn returns_evaluation_errors_with_the_request_id() {
        let response = process_request_line(&request(
            11,
            serde_json::json!({
                "elements": [],
                "scalarProgram": { "statements": "not-an-array" }
            }),
        ))
        .expect("error response");
        let value: Value = serde_json::from_str(&response).expect("valid response JSON");
        assert_eq!(value["id"], 11);
        assert!(value["error"].as_str().is_some());
    }

    #[test]
    fn processes_multiple_line_delimited_requests_independently() {
        let first = process_request_line(&request(1, serde_json::json!({ "elements": [] })))
            .expect("first response");
        let second = process_request_line(&request(2, serde_json::json!({ "elements": [] })))
            .expect("second response");
        assert_eq!(serde_json::from_str::<Value>(&first).unwrap()["id"], 1);
        assert_eq!(serde_json::from_str::<Value>(&second).unwrap()["id"], 2);
    }

    #[test]
    fn exports_svg_through_the_distinct_stdio_envelope() {
        let path = temporary_export_path("valid");
        let response =
            process_request_line(&svg_export_request(13, &path, 10.0)).expect("export response");
        let value: Value = serde_json::from_str(&response).expect("valid response JSON");
        assert_eq!(value["id"], 13);
        assert_eq!(value["payload"]["exported"], true, "{value}");
        let svg = fs::read_to_string(&path).expect("SVG should be written");
        assert!(svg.contains(r#"width="10mm" height="10mm""#));
        fs::remove_file(path).expect("temporary SVG should be removable");
    }

    #[test]
    fn encoding_failure_does_not_touch_an_existing_file() {
        let path = temporary_export_path("invalid");
        fs::write(&path, "existing").expect("fixture should be written");
        let response = process_request_line(&svg_export_request(17, &path, 0.0))
            .expect("export error response");
        let value: Value = serde_json::from_str(&response).expect("valid response JSON");
        assert_eq!(value["id"], 17);
        assert!(value["error"].as_str().is_some());
        assert_eq!(fs::read_to_string(&path).unwrap(), "existing");
        fs::remove_file(path).expect("temporary SVG should be removable");
    }

    #[test]
    fn unsupported_pdf_text_does_not_touch_an_existing_file() {
        let path = temporary_export_path("unsupported-pdf-text");
        fs::write(&path, "existing").expect("fixture should be written");
        let response = process_request_line(&unsupported_pdf_text_export_request(19, &path))
            .expect("export error response");
        let value: Value = serde_json::from_str(&response).expect("valid response JSON");
        assert_eq!(value["id"], 19);
        assert!(value["error"]
            .as_str()
            .is_some_and(|error| error.contains("U+1F600")));
        assert_eq!(fs::read_to_string(&path).unwrap(), "existing");
        fs::remove_file(path).expect("temporary fixture should be removable");
    }
}
