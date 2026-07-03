use serde::Deserialize;
use std::fs;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPrintSvgInput {
    path: String,
    canvas: SvgCanvasInput,
    paths: Vec<PrintablePath>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SvgCanvasInput {
    width_mm: f64,
    height_mm: f64,
}

#[derive(Debug, Deserialize, Clone, Copy)]
struct PrintPoint {
    x: f64,
    y: f64,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum PrintablePath {
    Line {
        start: PrintPoint,
        end: PrintPoint,
    },
    Bezier {
        start: PrintPoint,
        control1: PrintPoint,
        control2: PrintPoint,
        end: PrintPoint,
    },
    Polyline {
        points: Vec<PrintPoint>,
    },
}

#[tauri::command]
pub fn export_print_svg(input: ExportPrintSvgInput) -> Result<(), String> {
    let svg = build_print_svg(&input)?;
    fs::write(&input.path, svg).map_err(|error| format!("SVGを書き出せません: {error}"))
}

const SVG_PATH_LINE_WIDTH_MM: f64 = 0.18;

fn svg_number(value: f64) -> String {
    if !value.is_finite() {
        return "0".to_owned();
    }
    let rounded = (value * 1000.0).round() / 1000.0;
    if (rounded - rounded.round()).abs() < 0.000_5 {
        format!("{rounded:.0}")
    } else {
        format!("{rounded:.3}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_owned()
    }
}

fn svg_point(point: PrintPoint, canvas_height_mm: f64) -> (String, String) {
    (svg_number(point.x), svg_number(canvas_height_mm - point.y))
}

fn path_data(path: &PrintablePath, canvas_height_mm: f64) -> Option<String> {
    match path {
        PrintablePath::Line { start, end } => {
            let (x1, y1) = svg_point(*start, canvas_height_mm);
            let (x2, y2) = svg_point(*end, canvas_height_mm);
            Some(format!("M {x1} {y1} L {x2} {y2}"))
        }
        PrintablePath::Bezier {
            start,
            control1,
            control2,
            end,
        } => {
            let (x1, y1) = svg_point(*start, canvas_height_mm);
            let (c1x, c1y) = svg_point(*control1, canvas_height_mm);
            let (c2x, c2y) = svg_point(*control2, canvas_height_mm);
            let (x2, y2) = svg_point(*end, canvas_height_mm);
            Some(format!("M {x1} {y1} C {c1x} {c1y} {c2x} {c2y} {x2} {y2}"))
        }
        PrintablePath::Polyline { points } => {
            let first = points.first()?;
            let (x, y) = svg_point(*first, canvas_height_mm);
            let mut data = format!("M {x} {y}");
            for point in points.iter().skip(1) {
                let (x, y) = svg_point(*point, canvas_height_mm);
                data.push_str(&format!(" L {x} {y}"));
            }
            Some(data)
        }
    }
}

fn build_print_svg(input: &ExportPrintSvgInput) -> Result<String, String> {
    if input.canvas.width_mm <= 0.0
        || input.canvas.height_mm <= 0.0
        || !input.canvas.width_mm.is_finite()
        || !input.canvas.height_mm.is_finite()
    {
        return Err("SVGキャンバスサイズが不正です。".to_owned());
    }

    let width = svg_number(input.canvas.width_mm);
    let height = svg_number(input.canvas.height_mm);
    let stroke_width = svg_number(SVG_PATH_LINE_WIDTH_MM);
    let mut svg = String::new();
    svg.push_str(r#"<?xml version="1.0" encoding="UTF-8"?>"#);
    svg.push('\n');
    svg.push_str(&format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}mm" height="{height}mm" viewBox="0 0 {width} {height}">"#
    ));
    svg.push('\n');
    svg.push_str(&format!(
        r##"  <g fill="none" stroke="#000000" stroke-width="{stroke_width}" stroke-linecap="round" stroke-linejoin="round">"##
    ));
    svg.push('\n');
    for path in &input.paths {
        let Some(data) = path_data(path, input.canvas.height_mm) else {
            continue;
        };
        svg.push_str(&format!(r#"    <path d="{data}" />"#));
        svg.push('\n');
    }
    svg.push_str("  </g>\n</svg>\n");
    Ok(svg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_plain_svg_with_mm_canvas_and_y_axis_conversion() {
        let input = ExportPrintSvgInput {
            path: "unused.svg".to_owned(),
            canvas: SvgCanvasInput {
                width_mm: 100.0,
                height_mm: 80.0,
            },
            paths: vec![
                PrintablePath::Line {
                    start: PrintPoint { x: 0.0, y: 0.0 },
                    end: PrintPoint { x: 10.0, y: 20.0 },
                },
                PrintablePath::Bezier {
                    start: PrintPoint { x: 10.0, y: 20.0 },
                    control1: PrintPoint { x: 15.0, y: 25.0 },
                    control2: PrintPoint { x: 20.0, y: 25.0 },
                    end: PrintPoint { x: 25.0, y: 20.0 },
                },
                PrintablePath::Polyline {
                    points: vec![PrintPoint { x: 1.0, y: 1.0 }, PrintPoint { x: 2.0, y: 3.0 }],
                },
            ],
        };

        let svg = build_print_svg(&input).expect("svg should build");
        assert!(svg.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"));
        assert!(svg.contains(r#"<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="80mm" viewBox="0 0 100 80">"#));
        assert!(svg.contains(r#"stroke-width="0.18""#));
        assert!(svg.contains(r#"<path d="M 0 80 L 10 60" />"#));
        assert!(svg.contains(r#"<path d="M 10 60 C 15 55 20 55 25 60" />"#));
        assert!(svg.contains(r#"<path d="M 1 79 L 2 77" />"#));
    }

    #[test]
    fn rejects_invalid_canvas_size() {
        let input = ExportPrintSvgInput {
            path: "unused.svg".to_owned(),
            canvas: SvgCanvasInput {
                width_mm: 0.0,
                height_mm: 80.0,
            },
            paths: vec![],
        };

        assert_eq!(
            build_print_svg(&input).expect_err("canvas should be invalid"),
            "SVGキャンバスサイズが不正です。"
        );
    }
}
