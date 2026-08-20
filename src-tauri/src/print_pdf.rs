use crate::print_output::{
    validate_print_payload, OutputDrawable, OutputGuide, OutputPathSegment, OutputPoint,
    OutputStroke, ResolvedPrintOutputPayload,
};
use serde::Deserialize;
use std::f64::consts::PI;
use std::fs;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPrintPdfInput {
    path: String,
    payload: ResolvedPrintOutputPayload,
}

#[tauri::command]
pub fn export_print_pdf(input: ExportPrintPdfInput) -> Result<(), String> {
    let pdf = build_print_pdf(&input.payload)?;
    fs::write(&input.path, pdf).map_err(|error| format!("PDFを書き出せません: {error}"))
}

const PT_PER_MM: f64 = 72.0 / 25.4;
const PRINT_LINE_WIDTH_MM: f64 = 0.18;

fn pt(value_mm: f64) -> f64 {
    value_mm * PT_PER_MM
}

fn pdf_number(value: f64) -> String {
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

fn page_point(point: OutputPoint, origin: OutputPoint) -> (String, String) {
    (
        pdf_number(pt(point.x - origin.x)),
        pdf_number(pt(point.y - origin.y)),
    )
}

fn pdf_utf16_hex(value: &str) -> String {
    let mut output = String::from("<FEFF");
    for unit in value.encode_utf16() {
        output.push_str(&format!("{unit:04X}"));
    }
    output.push('>');
    output
}

fn color_operator(hex: &str) -> String {
    let red = u8::from_str_radix(&hex[1..3], 16).unwrap_or(0) as f64 / 255.0;
    let green = u8::from_str_radix(&hex[3..5], 16).unwrap_or(0) as f64 / 255.0;
    let blue = u8::from_str_radix(&hex[5..7], 16).unwrap_or(0) as f64 / 255.0;
    format!(
        "{} {} {} RG",
        pdf_number(red),
        pdf_number(green),
        pdf_number(blue)
    )
}

fn dash_operator(stroke: &OutputStroke) -> &'static str {
    match stroke.style.as_str() {
        "dashed" => "[4 3] 0 d",
        "dotted" => "[1 2] 0 d",
        _ => "[] 0 d",
    }
}

fn arc_cubic_segments(
    center: OutputPoint,
    radius: f64,
    start_angle_deg: f64,
    sweep_angle_deg: f64,
) -> Vec<(OutputPoint, OutputPoint, OutputPoint, OutputPoint)> {
    let count = (sweep_angle_deg.abs() / 90.0).ceil().max(1.0) as usize;
    let delta = sweep_angle_deg / count as f64;
    (0..count)
        .map(|index| {
            let start = (start_angle_deg + index as f64 * delta).to_radians();
            let end = (start_angle_deg + (index + 1) as f64 * delta).to_radians();
            let k = 4.0 / 3.0 * ((end - start) / 4.0).tan();
            let start_point = OutputPoint {
                x: center.x + radius * start.cos(),
                y: center.y + radius * start.sin(),
            };
            let end_point = OutputPoint {
                x: center.x + radius * end.cos(),
                y: center.y + radius * end.sin(),
            };
            let control1 = OutputPoint {
                x: start_point.x - radius * k * start.sin(),
                y: start_point.y + radius * k * start.cos(),
            };
            let control2 = OutputPoint {
                x: end_point.x + radius * k * end.sin(),
                y: end_point.y - radius * k * end.cos(),
            };
            (start_point, control1, control2, end_point)
        })
        .collect()
}

fn push_segment(content: &mut String, segment: &OutputPathSegment, origin: OutputPoint) {
    match segment {
        OutputPathSegment::Line { start, end } => {
            let (x1, y1) = page_point(*start, origin);
            let (x2, y2) = page_point(*end, origin);
            content.push_str(&format!("{x1} {y1} m {x2} {y2} l\n"));
        }
        OutputPathSegment::Bezier {
            start,
            control1,
            control2,
            end,
        } => {
            let (x1, y1) = page_point(*start, origin);
            let (c1x, c1y) = page_point(*control1, origin);
            let (c2x, c2y) = page_point(*control2, origin);
            let (x2, y2) = page_point(*end, origin);
            content.push_str(&format!(
                "{x1} {y1} m {c1x} {c1y} {c2x} {c2y} {x2} {y2} c\n"
            ));
        }
        OutputPathSegment::Arc {
            center,
            radius,
            start_angle_deg,
            sweep_angle_deg,
        } => {
            for (index, (start, control1, control2, end)) in
                arc_cubic_segments(*center, *radius, *start_angle_deg, *sweep_angle_deg)
                    .into_iter()
                    .enumerate()
            {
                let (x1, y1) = page_point(start, origin);
                let (c1x, c1y) = page_point(control1, origin);
                let (c2x, c2y) = page_point(control2, origin);
                let (x2, y2) = page_point(end, origin);
                if index == 0 {
                    content.push_str(&format!("{x1} {y1} m "));
                }
                content.push_str(&format!("{c1x} {c1y} {c2x} {c2y} {x2} {y2} c\n"));
            }
        }
    }
}

fn push_stroked_path(
    content: &mut String,
    segment: &OutputPathSegment,
    stroke: &OutputStroke,
    origin: OutputPoint,
) {
    content.push_str(&format!(
        "{} {} w {}\n",
        color_operator(&stroke.color_hex),
        pdf_number(pt(stroke.width_mm)),
        dash_operator(stroke)
    ));
    push_segment(content, segment, origin);
    content.push_str("S\n");
}

struct PdfTextPlacement {
    anchor: OutputPoint,
    font_size_mm: f64,
    line_height_mm: f64,
    rotation_deg: f64,
    mirror_x: bool,
}

fn push_text(
    content: &mut String,
    text: &str,
    placement: PdfTextPlacement,
    color_hex: &str,
    origin: OutputPoint,
) {
    let (x, _y) = page_point(placement.anchor, origin);
    let angle = placement.rotation_deg * PI / 180.0;
    let sign = if placement.mirror_x { -1.0 } else { 1.0 };
    let a = angle.cos() * sign;
    let b = angle.sin() * sign;
    let c = -angle.sin();
    let d = angle.cos();
    let size = pdf_number(pt(placement.font_size_mm));
    for (index, line) in text.lines().enumerate() {
        let line_y = pdf_number(pt(placement.anchor.y
            - origin.y
            - placement.font_size_mm * 0.8
            - placement.line_height_mm * index as f64));
        content.push_str(&format!(
            "BT {} /F1 {size} Tf {a} {b} {c} {d} {x} {line_y} Tm {} Tj ET\n",
            color_operator(color_hex),
            pdf_utf16_hex(line)
        ));
    }
}

fn push_drawable(content: &mut String, drawable: &OutputDrawable, origin: OutputPoint) {
    match drawable {
        OutputDrawable::Line {
            start, end, stroke, ..
        } => push_stroked_path(
            content,
            &OutputPathSegment::Line {
                start: *start,
                end: *end,
            },
            stroke,
            origin,
        ),
        OutputDrawable::Bezier {
            start,
            control1,
            control2,
            end,
            stroke,
            ..
        } => push_stroked_path(
            content,
            &OutputPathSegment::Bezier {
                start: *start,
                control1: *control1,
                control2: *control2,
                end: *end,
            },
            stroke,
            origin,
        ),
        OutputDrawable::Arc {
            center,
            radius,
            start_angle_deg,
            sweep_angle_deg,
            stroke,
            ..
        } => push_stroked_path(
            content,
            &OutputPathSegment::Arc {
                center: *center,
                radius: *radius,
                start_angle_deg: *start_angle_deg,
                sweep_angle_deg: *sweep_angle_deg,
            },
            stroke,
            origin,
        ),
        OutputDrawable::OffsetLine {
            segments, stroke, ..
        } => {
            for segment in segments {
                push_stroked_path(content, segment, stroke, origin);
            }
        }
        OutputDrawable::Text {
            text,
            anchor,
            font_size_mm,
            line_height_mm,
            rotation_deg,
            mirror_x,
            color_hex,
            ..
        } => push_text(
            content,
            text,
            PdfTextPlacement {
                anchor: *anchor,
                font_size_mm: *font_size_mm,
                line_height_mm: *line_height_mm,
                rotation_deg: *rotation_deg,
                mirror_x: *mirror_x,
            },
            color_hex,
            origin,
        ),
    }
}

fn push_guide(
    content: &mut String,
    guide: &OutputGuide,
    paper_width_mm: f64,
    paper_height_mm: f64,
    margin_mm: f64,
    overlap_mm: f64,
) {
    let guide_x = if guide.axis == "vertical" {
        guide.position_mm
    } else {
        0.0
    };
    let guide_y = if guide.axis == "horizontal" {
        guide.position_mm
    } else {
        0.0
    };
    let line_width = pdf_number(pt(PRINT_LINE_WIDTH_MM));
    content.push_str(&format!("q 0 G {line_width} w [4 3] 0 d\n"));
    if guide.axis == "vertical" {
        let x = pdf_number(pt(guide_x));
        content.push_str(&format!(
            "{x} 0 m {x} {} l S\n",
            pdf_number(pt(paper_height_mm))
        ));
        push_text(
            content,
            &guide.label,
            PdfTextPlacement {
                anchor: OutputPoint {
                    x: guide_x,
                    y: paper_height_mm / 2.0,
                },
                font_size_mm: guide.label_font_size_mm,
                line_height_mm: guide.label_font_size_mm * 1.2,
                rotation_deg: guide.label_rotation_deg,
                mirror_x: false,
            },
            "#31322f",
            OutputPoint { x: 0.0, y: 0.0 },
        );
    } else {
        let y = pdf_number(pt(guide_y));
        content.push_str(&format!(
            "0 {y} m {} {y} l S\n",
            pdf_number(pt(paper_width_mm))
        ));
        push_text(
            content,
            &guide.label,
            PdfTextPlacement {
                anchor: OutputPoint {
                    x: paper_width_mm / 2.0,
                    y: guide_y,
                },
                font_size_mm: guide.label_font_size_mm,
                line_height_mm: guide.label_font_size_mm * 1.2,
                rotation_deg: guide.label_rotation_deg,
                mirror_x: false,
            },
            "#31322f",
            OutputPoint { x: 0.0, y: 0.0 },
        );
    }
    content.push_str(&format!(
        "% guide margin={} overlap={}\nQ\n",
        pdf_number(pt(margin_mm)),
        pdf_number(pt(overlap_mm))
    ));
}

fn page_content(payload: &ResolvedPrintOutputPayload, page_index: usize) -> String {
    let page = &payload.pages[page_index];
    let width = pdf_number(pt(payload.paper.width_mm));
    let height = pdf_number(pt(payload.paper.height_mm));
    let mut content = String::new();
    content.push_str("q\n");
    content.push_str(&format!("0 0 {width} {height} re W n\n"));
    for drawable in &payload.drawables {
        push_drawable(&mut content, drawable, page.origin);
    }
    content.push_str("Q\n");
    for guide in &page.guides {
        push_guide(
            &mut content,
            guide,
            payload.paper.width_mm,
            payload.paper.height_mm,
            payload.margin_mm,
            payload.overlap_mm,
        );
    }
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

fn build_print_pdf(payload: &ResolvedPrintOutputPayload) -> Result<Vec<u8>, String> {
    validate_print_payload(payload)?;
    let page_count = payload.pages.len();
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
    let media_width = pdf_number(pt(payload.paper.width_mm));
    let media_height = pdf_number(pt(payload.paper.height_mm));
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
    for page_index in 0..page_count {
        objects.push(stream_object(&page_content(payload, page_index)));
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
    use crate::print_output::{OutputBounds, OutputPrintPage};

    fn payload() -> ResolvedPrintOutputPayload {
        ResolvedPrintOutputPayload {
            version: 1,
            kind: "print".to_owned(),
            bounds: OutputBounds {
                min_x: 0.0,
                min_y: 0.0,
                max_x: 100.0,
                max_y: 80.0,
                width: 100.0,
                height: 80.0,
            },
            drawables: vec![OutputDrawable::Line {
                element_id: "line".to_owned(),
                name: "line".to_owned(),
                start: OutputPoint { x: 0.0, y: 0.0 },
                end: OutputPoint { x: 10.0, y: 0.0 },
                stroke: OutputStroke {
                    width_mm: 0.18,
                    style: "solid".to_owned(),
                    color_hex: "#31322f".to_owned(),
                },
            }],
            paper: crate::print_output::PaperSize {
                width_mm: 210.0,
                height_mm: 297.0,
            },
            margin_mm: 10.0,
            overlap_mm: 10.0,
            stride: OutputPoint { x: 180.0, y: 267.0 },
            pages: vec![
                OutputPrintPage {
                    index: 0,
                    column: 0,
                    row: 0,
                    origin: OutputPoint { x: -10.0, y: -10.0 },
                    guides: vec![],
                },
                OutputPrintPage {
                    index: 1,
                    column: 1,
                    row: 0,
                    origin: OutputPoint { x: 170.0, y: -10.0 },
                    guides: vec![],
                },
            ],
        }
    }

    #[test]
    fn builds_pages_in_payload_order_and_validates_payload() {
        let pdf = build_print_pdf(&payload()).expect("pdf should build");
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.starts_with("%PDF-1.4"));
        assert!(text.contains("/Count 2"));
        assert!(text.contains("0.192 0.196 0.184 RG"));
    }

    #[test]
    fn rejects_invalid_overlap() {
        let mut invalid = payload();
        invalid.overlap_mm = 200.0;
        assert!(build_print_pdf(&invalid).is_err());
    }
}
