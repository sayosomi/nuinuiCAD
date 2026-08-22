use std::{env, fs, io};

use nuinuicad_rust_evaluator::{evaluate_document, EvaluationInput};

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let input_json = match env::args().nth(1) {
        Some(path) => fs::read_to_string(path)?,
        None => io::read_to_string(io::stdin())?,
    };
    let input = serde_json::from_str::<EvaluationInput>(&input_json)?;
    let payload = evaluate_document(input)?;
    println!("{}", serde_json::to_string(&payload)?);
    Ok(())
}
