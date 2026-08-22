use nuinuicad_rust_evaluator::{evaluate_document, EvaluationInput, EvaluationPayload};
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};

#[derive(Debug, Deserialize)]
struct EvaluationRequest {
    id: u64,
    input: EvaluationInput,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum EvaluationResponse {
    Success {
        id: u64,
        payload: Box<EvaluationPayload>,
    },
    Error {
        id: u64,
        error: String,
    },
}

fn process_request_line(line: &str) -> Result<String, serde_json::Error> {
    let request: EvaluationRequest = serde_json::from_str(line)?;
    let response = match evaluate_document(request.input) {
        Ok(payload) => EvaluationResponse::Success {
            id: request.id,
            payload: Box::new(payload),
        },
        Err(error) => EvaluationResponse::Error {
            id: request.id,
            error: error.to_string(),
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

    fn request(id: u64, input: Value) -> String {
        serde_json::json!({ "id": id, "input": input }).to_string()
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
}
