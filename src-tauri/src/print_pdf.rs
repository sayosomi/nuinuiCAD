use serde::Deserialize;
use std::fs;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPrintPdfInput {
    path: String,
    layout: PrintLayoutInput,
    paper: PaperInput,
    paths: Vec<PrintablePath>,
    #[serde(default)]
    texts: Vec<PrintableText>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrintLayoutInput {
    columns: usize,
    rows: usize,
    overlap_mm: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaperInput {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrintableText {
    text: String,
    anchor: PrintPoint,
    font_size: f64,
}

#[tauri::command]
pub fn export_print_pdf(input: ExportPrintPdfInput) -> Result<(), String> {
    let pdf = build_print_pdf(&input)?;
    fs::write(&input.path, pdf).map_err(|error| format!("PDFを書き出せません: {error}"))
}

const PT_PER_MM: f64 = 72.0 / 25.4;
const PRINT_PATH_LINE_WIDTH_MM: f64 = 0.18;
const PRINT_GUIDE_LINE_WIDTH_MM: f64 = PRINT_PATH_LINE_WIDTH_MM;

fn pt(value_mm: f64) -> f64 {
    value_mm * PT_PER_MM
}

fn pdf_number(value: f64) -> String {
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

fn pdf_mm(value_mm: f64) -> String {
    pdf_number(pt(value_mm))
}

fn point_on_page(point: PrintPoint, page_origin: PrintPoint) -> (String, String) {
    (
        pdf_number(pt(point.x - page_origin.x)),
        pdf_number(pt(point.y - page_origin.y)),
    )
}

fn push_path(content: &mut String, path: &PrintablePath, page_origin: PrintPoint) {
    match path {
        PrintablePath::Line { start, end } => {
            let (x1, y1) = point_on_page(*start, page_origin);
            let (x2, y2) = point_on_page(*end, page_origin);
            content.push_str(&format!("{x1} {y1} m {x2} {y2} l S\n"));
        }
        PrintablePath::Bezier {
            start,
            control1,
            control2,
            end,
        } => {
            let (x1, y1) = point_on_page(*start, page_origin);
            let (c1x, c1y) = point_on_page(*control1, page_origin);
            let (c2x, c2y) = point_on_page(*control2, page_origin);
            let (x2, y2) = point_on_page(*end, page_origin);
            content.push_str(&format!(
                "{x1} {y1} m {c1x} {c1y} {c2x} {c2y} {x2} {y2} c S\n"
            ));
        }
        PrintablePath::Polyline { points } => {
            let Some(first) = points.first() else {
                return;
            };
            let (x, y) = point_on_page(*first, page_origin);
            content.push_str(&format!("{x} {y} m "));
            for point in points.iter().skip(1) {
                let (x, y) = point_on_page(*point, page_origin);
                content.push_str(&format!("{x} {y} l "));
            }
            content.push_str("S\n");
        }
    }
}

fn pdf_utf16_hex(value: &str) -> String {
    let mut output = String::from("<FEFF");
    for unit in value.encode_utf16() {
        output.push_str(&format!("{unit:04X}"));
    }
    output.push('>');
    output
}

fn push_text(content: &mut String, text: &PrintableText, page_origin: PrintPoint) {
    if text.font_size <= 0.0 || !text.font_size.is_finite() {
        return;
    }
    let font_size = pdf_number(pt(text.font_size));
    for (index, line) in text.text.lines().enumerate() {
        let point = PrintPoint {
            x: text.anchor.x,
            y: text.anchor.y - text.font_size * (index as f64 + 1.0),
        };
        let (x, y) = point_on_page(point, page_origin);
        content.push_str(&format!(
            "BT /F1 {font_size} Tf 1 0 0 1 {x} {y} Tm {} Tj ET\n",
            pdf_utf16_hex(line)
        ));
    }
}

fn push_guides(content: &mut String, paper: &PaperInput, overlap_mm: f64) {
    if overlap_mm <= 0.0 {
        return;
    }
    let width = pt(paper.width_mm);
    let height = pt(paper.height_mm);
    let overlap = pt(overlap_mm
        .min(paper.width_mm / 2.0)
        .min(paper.height_mm / 2.0));
    let width_s = pdf_number(width);
    let height_s = pdf_number(height);
    let overlap_s = pdf_number(overlap);
    let right_s = pdf_number(width - overlap);
    let top_s = pdf_number(height - overlap);

    let guide_line_width = pdf_mm(PRINT_GUIDE_LINE_WIDTH_MM);
    content.push_str(&format!("q 0 G {guide_line_width} w [4 3] 0 d\n"));
    content.push_str(&format!("{overlap_s} 0 m {overlap_s} {height_s} l S\n"));
    content.push_str(&format!("{right_s} 0 m {right_s} {height_s} l S\n"));
    content.push_str(&format!("0 {overlap_s} m {width_s} {overlap_s} l S\n"));
    content.push_str(&format!("0 {top_s} m {width_s} {top_s} l S\n"));
    content.push_str("Q\n");
}

fn page_content(input: &ExportPrintPdfInput, column: usize, row: usize) -> String {
    let page_step_x = (input.paper.width_mm - input.layout.overlap_mm).max(1.0);
    let page_step_y = (input.paper.height_mm - input.layout.overlap_mm).max(1.0);
    let canvas_height =
        input.paper.height_mm + (input.layout.rows.saturating_sub(1) as f64) * page_step_y;
    let page_origin = PrintPoint {
        x: column as f64 * page_step_x,
        y: canvas_height - input.paper.height_mm - row as f64 * page_step_y,
    };
    let width = pdf_number(pt(input.paper.width_mm));
    let height = pdf_number(pt(input.paper.height_mm));
    let mut content = String::new();

    content.push_str("q\n");
    content.push_str(&format!("0 0 {width} {height} re W n\n"));
    let path_line_width = pdf_mm(PRINT_PATH_LINE_WIDTH_MM);
    content.push_str(&format!("0 G {path_line_width} w 1 J 1 j\n"));
    for path in &input.paths {
        push_path(&mut content, path, page_origin);
    }
    for text in &input.texts {
        push_text(&mut content, text, page_origin);
    }
    content.push_str("Q\n");
    push_guides(&mut content, &input.paper, input.layout.overlap_mm);
    content
}

fn pdf_object(body: &str) -> Vec<u8> {
    body.as_bytes().to_vec()
}

fn stream_object(content: &str) -> Vec<u8> {
    format!(
        "<< /Length {} >>\nstream\n{}endstream",
        content.len(),
        content
    )
    .into_bytes()
}

fn build_print_pdf(input: &ExportPrintPdfInput) -> Result<Vec<u8>, String> {
    if input.layout.columns == 0 || input.layout.rows == 0 {
        return Err("用紙枚数は1以上にしてください。".to_owned());
    }
    if input.paper.width_mm <= 0.0 || input.paper.height_mm <= 0.0 {
        return Err("用紙サイズが不正です。".to_owned());
    }

    let page_count = input.layout.columns * input.layout.rows;
    let catalog_id = 1usize;
    let pages_id = 2usize;
    let first_page_id = 3usize;
    let font_id = first_page_id + page_count;
    let cid_font_id = font_id + 1;
    let first_content_id = cid_font_id + 1;
    let mut objects = Vec::<Vec<u8>>::new();

    objects.push(pdf_object("<< /Type /Catalog /Pages 2 0 R >>"));

    let kids = (0..page_count)
        .map(|index| format!("{} 0 R", first_page_id + index))
        .collect::<Vec<_>>()
        .join(" ");
    objects.push(pdf_object(&format!(
        "<< /Type /Pages /Count {page_count} /Kids [{kids}] >>"
    )));

    let media_width = pdf_number(pt(input.paper.width_mm));
    let media_height = pdf_number(pt(input.paper.height_mm));
    for index in 0..page_count {
        let content_id = first_content_id + index;
        objects.push(pdf_object(&format!(
            "<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {media_width} {media_height}] /Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>"
        )));
    }

    objects.push(pdf_object(&format!(
        "<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5 /Encoding /UniJIS-UCS2-H /DescendantFonts [{cid_font_id} 0 R] >>"
    )));
    objects.push(pdf_object(
        "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor << /Type /FontDescriptor /FontName /HeiseiKakuGo-W5 /Flags 4 /FontBBox [-92 -250 1010 922] /ItalicAngle 0 /Ascent 752 /Descent -221 /CapHeight 737 /StemV 80 >> >>",
    ));

    for row in 0..input.layout.rows {
        for column in 0..input.layout.columns {
            objects.push(stream_object(&page_content(input, column, row)));
        }
    }

    let mut pdf = Vec::<u8>::new();
    pdf.extend_from_slice(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    let mut offsets = Vec::<usize>::with_capacity(objects.len() + 1);
    offsets.push(0);
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend_from_slice(format!("{} 0 obj\n", index + 1).as_bytes());
        pdf.extend_from_slice(object);
        pdf.extend_from_slice(b"\nendobj\n");
    }

    let xref_offset = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n", objects.len() + 1).as_bytes());
    pdf.extend_from_slice(b"0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root {catalog_id} 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    Ok(pdf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_multi_page_pdf() {
        let input = ExportPrintPdfInput {
            path: "unused.pdf".to_owned(),
            layout: PrintLayoutInput {
                columns: 2,
                rows: 1,
                overlap_mm: 10.0,
            },
            paper: PaperInput {
                width_mm: 210.0,
                height_mm: 297.0,
            },
            paths: vec![PrintablePath::Line {
                start: PrintPoint { x: 0.0, y: 0.0 },
                end: PrintPoint { x: 10.0, y: 0.0 },
            }],
            texts: vec![PrintableText {
                text: "前中心".to_owned(),
                anchor: PrintPoint { x: 5.0, y: 20.0 },
                font_size: 3.0,
            }],
        };

        let pdf = build_print_pdf(&input).expect("pdf should build");
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.starts_with("%PDF-1.4"));
        assert!(text.contains("/Count 2"));
        assert!(text.contains("0 G 0.51 w 1 J 1 j"));
        assert!(text.contains("q 0 G 0.51 w [4 3] 0 d"));
        assert!(text.contains("28.346 0 m 28.346 841.89 l S"));
        assert!(text.contains("/Encoding /UniJIS-UCS2-H"));
        assert!(text.contains("<FEFF524D4E2D5FC3> Tj"));
    }
}
