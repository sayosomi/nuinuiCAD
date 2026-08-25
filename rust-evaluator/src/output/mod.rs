mod payload;
mod pdf;
mod svg;

use serde::Deserialize;
use std::fs;

pub use payload::{ResolvedPrintOutputPayload, ResolvedSvgOutputPayload};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportOutputInput {
    pub path: String,
    pub payload: serde_json::Value,
}

pub fn export_output(input: ExportOutputInput) -> Result<(), String> {
    let bytes = match input
        .payload
        .get("kind")
        .and_then(serde_json::Value::as_str)
    {
        Some("svg") => {
            let payload: ResolvedSvgOutputPayload = serde_json::from_value(input.payload)
                .map_err(|error| format!("Invalid SVG output payload: {error}"))?;
            svg::encode_svg(&payload)?.into_bytes()
        }
        Some("print") => {
            let payload: ResolvedPrintOutputPayload = serde_json::from_value(input.payload)
                .map_err(|error| format!("Invalid PDF output payload: {error}"))?;
            pdf::encode_pdf(&payload)?
        }
        Some(kind) => return Err(format!("Unsupported output payload kind: {kind}")),
        None => return Err("Output payload kind is required".to_owned()),
    };
    fs::write(&input.path, bytes).map_err(|error| format!("Could not write output file: {error}"))
}
