use crate::print_output::{
    text_bounds_relative, validate_print_payload, OutputDrawable, OutputGuide, OutputPathSegment,
    OutputPoint, OutputStroke, ResolvedPrintOutputPayload, OUTPUT_TEXT_LINE_HEIGHT,
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

fn pdf_ucs2_hex(character: char) -> Result<String, String> {
    let code = character as u32;
    if code > u16::MAX as u32 {
        return Err(format!(
            "PDF text character U+{code:04X} is not representable by /UniJIS-UCS2-H"
        ));
    }
    Ok(format!("<{code:04X}>"))
}

fn color_components(hex: &str) -> (f64, f64, f64) {
    let red = u8::from_str_radix(&hex[1..3], 16).unwrap_or(0) as f64 / 255.0;
    let green = u8::from_str_radix(&hex[3..5], 16).unwrap_or(0) as f64 / 255.0;
    let blue = u8::from_str_radix(&hex[5..7], 16).unwrap_or(0) as f64 / 255.0;
    (red, green, blue)
}

fn color_operator(hex: &str) -> String {
    let (red, green, blue) = color_components(hex);
    format!(
        "{} {} {} RG",
        pdf_number(red),
        pdf_number(green),
        pdf_number(blue)
    )
}

fn non_stroking_color_operator(hex: &str) -> String {
    let (red, green, blue) = color_components(hex);
    format!(
        "{} {} {} rg",
        pdf_number(red),
        pdf_number(green),
        pdf_number(blue)
    )
}

fn dash_operator_for_style(style: &str) -> String {
    match style {
        "dashed" => format!("[{} {}] 0 d", pdf_number(pt(4.0)), pdf_number(pt(3.0))),
        "dotted" => format!("[{} {}] 0 d", pdf_number(pt(1.0)), pdf_number(pt(2.0))),
        _ => "[] 0 d".to_owned(),
    }
}

fn dash_operator(stroke: &OutputStroke) -> String {
    dash_operator_for_style(&stroke.style)
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
        "{} 1 J 1 j {} w {}\n",
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
    line_widths_mm: Vec<f64>,
    line_advances_mm: Vec<Vec<f64>>,
    line_height_mm: f64,
    rotation_deg: f64,
    mirror_x: bool,
}

fn text_local_point(
    placement: &PdfTextPlacement,
    local_x: f64,
    local_y: f64,
    origin: OutputPoint,
) -> (f64, f64) {
    let angle = placement.rotation_deg * PI / 180.0;
    let sign = if placement.mirror_x { -1.0 } else { 1.0 };
    let mirrored_x = local_x * sign;
    (
        placement.anchor.x - origin.x + mirrored_x * angle.cos() - local_y * angle.sin(),
        placement.anchor.y - origin.y + mirrored_x * angle.sin() + local_y * angle.cos(),
    )
}

fn centered_text_anchor(
    center: OutputPoint,
    font_size_mm: f64,
    line_widths_mm: &[f64],
    line_height_mm: f64,
    rotation_deg: f64,
    mirror_x: bool,
) -> OutputPoint {
    let bounds = text_bounds_relative(
        font_size_mm,
        line_widths_mm,
        line_height_mm,
        rotation_deg,
        mirror_x,
    );
    OutputPoint {
        x: center.x - (bounds.min_x + bounds.max_x) / 2.0,
        y: center.y - (bounds.min_y + bounds.max_y) / 2.0,
    }
}

fn pdf_text_array(
    line: &str,
    advances_mm: &[f64],
    width_mm: f64,
    font_size_mm: f64,
) -> Result<String, String> {
    let mut values = Vec::new();
    let mut measured_width_mm = 0.0;
    for (character, advance_mm) in line.chars().zip(advances_mm) {
        values.push(pdf_ucs2_hex(character)?);
        let adjustment = 1000.0 - (*advance_mm / font_size_mm * 1000.0);
        values.push(pdf_number(adjustment));
        measured_width_mm += *advance_mm;
    }
    let correction_mm = width_mm - measured_width_mm;
    if correction_mm.abs() > 1e-9 {
        values.push(pdf_number(-correction_mm / font_size_mm * 1000.0));
    }
    Ok(format!("[{}] TJ", values.join(" ")))
}

fn push_text(
    content: &mut String,
    text: &str,
    placement: PdfTextPlacement,
    color_hex: &str,
    origin: OutputPoint,
) -> Result<(), String> {
    let angle = placement.rotation_deg * PI / 180.0;
    let sign = if placement.mirror_x { -1.0 } else { 1.0 };
    let a = angle.cos() * sign;
    let b = angle.sin() * sign;
    let c = -angle.sin();
    let d = angle.cos();
    let size = pdf_number(pt(placement.font_size_mm));
    for (index, ((line, width_mm), advances_mm)) in text
        .split('\n')
        .zip(&placement.line_widths_mm)
        .zip(&placement.line_advances_mm)
        .enumerate()
    {
        let (line_x, line_y) = text_local_point(
            &placement,
            0.0,
            -(index as f64) * placement.line_height_mm,
            origin,
        );
        let text_array = pdf_text_array(line, advances_mm, *width_mm, placement.font_size_mm)?;
        content.push_str(&format!(
            "BT {} /F1 {size} Tf {} {} {} {} {} {} Tm {} ET\n",
            non_stroking_color_operator(color_hex),
            pdf_number(a),
            pdf_number(b),
            pdf_number(c),
            pdf_number(d),
            pdf_number(pt(line_x)),
            pdf_number(pt(line_y)),
            text_array
        ));
    }
    Ok(())
}

fn push_drawable(
    content: &mut String,
    drawable: &OutputDrawable,
    origin: OutputPoint,
) -> Result<(), String> {
    match drawable {
        OutputDrawable::Line {
            start, end, stroke, ..
        } => {
            push_stroked_path(
                content,
                &OutputPathSegment::Line {
                    start: *start,
                    end: *end,
                },
                stroke,
                origin,
            );
            Ok(())
        }
        OutputDrawable::Bezier {
            start,
            control1,
            control2,
            end,
            stroke,
            ..
        } => {
            push_stroked_path(
                content,
                &OutputPathSegment::Bezier {
                    start: *start,
                    control1: *control1,
                    control2: *control2,
                    end: *end,
                },
                stroke,
                origin,
            );
            Ok(())
        }
        OutputDrawable::Arc {
            center,
            radius,
            start_angle_deg,
            sweep_angle_deg,
            stroke,
            ..
        } => {
            push_stroked_path(
                content,
                &OutputPathSegment::Arc {
                    center: *center,
                    radius: *radius,
                    start_angle_deg: *start_angle_deg,
                    sweep_angle_deg: *sweep_angle_deg,
                },
                stroke,
                origin,
            );
            Ok(())
        }
        OutputDrawable::OffsetLine {
            segments, stroke, ..
        } => {
            for segment in segments {
                push_stroked_path(content, segment, stroke, origin);
            }
            Ok(())
        }
        OutputDrawable::Text {
            text,
            anchor,
            font_size_mm,
            line_widths_mm,
            line_advances_mm,
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
                line_widths_mm: line_widths_mm.clone(),
                line_advances_mm: line_advances_mm.clone(),
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
) -> Result<(), String> {
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
    content.push_str(&format!(
        "q 0 G 1 J 1 j {line_width} w {}\n",
        dash_operator_for_style("dashed")
    ));
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
                anchor: centered_text_anchor(
                    guide.label_center,
                    guide.label_font_size_mm,
                    &[guide.label_width_mm],
                    guide.label_font_size_mm * OUTPUT_TEXT_LINE_HEIGHT,
                    guide.label_rotation_deg,
                    false,
                ),
                font_size_mm: guide.label_font_size_mm,
                line_widths_mm: vec![guide.label_width_mm],
                line_advances_mm: vec![guide.label_advances_mm.clone()],
                line_height_mm: guide.label_font_size_mm * OUTPUT_TEXT_LINE_HEIGHT,
                rotation_deg: guide.label_rotation_deg,
                mirror_x: false,
            },
            "#31322f",
            OutputPoint { x: 0.0, y: 0.0 },
        )?;
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
                anchor: centered_text_anchor(
                    guide.label_center,
                    guide.label_font_size_mm,
                    &[guide.label_width_mm],
                    guide.label_font_size_mm * OUTPUT_TEXT_LINE_HEIGHT,
                    guide.label_rotation_deg,
                    false,
                ),
                font_size_mm: guide.label_font_size_mm,
                line_widths_mm: vec![guide.label_width_mm],
                line_advances_mm: vec![guide.label_advances_mm.clone()],
                line_height_mm: guide.label_font_size_mm * OUTPUT_TEXT_LINE_HEIGHT,
                rotation_deg: guide.label_rotation_deg,
                mirror_x: false,
            },
            "#31322f",
            OutputPoint { x: 0.0, y: 0.0 },
        )?;
    }
    content.push_str(&format!(
        "% guide margin={} overlap={}\nQ\n",
        pdf_number(pt(margin_mm)),
        pdf_number(pt(overlap_mm))
    ));
    Ok(())
}

fn page_content(payload: &ResolvedPrintOutputPayload, page_index: usize) -> Result<String, String> {
    let page = &payload.pages[page_index];
    let width = pdf_number(pt(payload.paper.width_mm));
    let height = pdf_number(pt(payload.paper.height_mm));
    let mut content = String::new();
    content.push_str("q\n");
    content.push_str(&format!("0 0 {width} {height} re W n\n"));
    for drawable in &payload.drawables {
        push_drawable(&mut content, drawable, page.origin)?;
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
        )?;
    }
    Ok(content)
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
        "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /DW 1000 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor << /Type /FontDescriptor /FontName /HeiseiKakuGo-W5 /Flags 4 /FontBBox [-92 -250 1010 922] /ItalicAngle 0 /Ascent 752 /Descent -221 /CapHeight 737 /StemV 80 >> >>",
    ));
    for page_index in 0..page_count {
        objects.push(stream_object(&page_content(payload, page_index)?));
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
    use crate::print_output::{text_bounds_relative, OutputBounds, OutputPrintPage};

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
        assert!(text.contains("/Kids [3 0 R 4 0 R]"));
        assert!(text.contains("/MediaBox [0 0 595.276 841.89]"));
        assert!(text.contains("0.192 0.196 0.184 RG"));
        assert!(text.contains("0.192 0.196 0.184 RG 1 J 1 j 0.51 w [] 0 d"));
        let first_page_content = text
            .find("28.346 28.346 m 56.693 28.346 l")
            .expect("first page should place the line from its page origin");
        let second_page_content = text
            .find("-481.89 28.346 m -453.543 28.346 l")
            .expect("second page should place the line from its distinct page origin");
        assert!(first_page_content < second_page_content);
    }

    #[test]
    fn rejects_invalid_overlap() {
        let mut invalid = payload();
        invalid.overlap_mm = 200.0;
        assert!(build_print_pdf(&invalid).is_err());
    }

    fn stroke_content(style: &str) -> String {
        let mut content = String::new();
        push_stroked_path(
            &mut content,
            &OutputPathSegment::Line {
                start: OutputPoint { x: 0.0, y: 0.0 },
                end: OutputPoint { x: 10.0, y: 0.0 },
            },
            &OutputStroke {
                width_mm: 0.18,
                style: style.to_owned(),
                color_hex: "#31322f".to_owned(),
            },
            OutputPoint { x: 0.0, y: 0.0 },
        );
        content
    }

    #[test]
    fn emits_round_line_cap_and_join_and_keeps_physical_stroke_width() {
        let content = stroke_content("solid");
        assert!(content.contains("1 J 1 j"));
        assert!(content.contains("0.51 w"));
    }

    #[test]
    fn converts_dashed_lengths_from_mm_to_pdf_points() {
        let content = stroke_content("dashed");
        assert!(content.contains("[11.339 8.504] 0 d"));
    }

    #[test]
    fn converts_dotted_lengths_from_mm_to_pdf_points() {
        let content = stroke_content("dotted");
        assert!(content.contains("[2.835 5.669] 0 d"));
    }

    #[test]
    fn emits_exact_ucs2_codes_for_latin_and_japanese_text() {
        assert_eq!(
            pdf_text_array("AB", &[2.48, 2.48], 4.96, 4.0).expect("Latin text should encode"),
            "[<0041> 380 <0042> 380] TJ"
        );
        assert_eq!(
            pdf_text_array("日本", &[4.0, 4.0], 8.0, 4.0).expect("Japanese text should encode"),
            "[<65E5> 0 <672C> 0] TJ"
        );
    }

    #[test]
    fn rejects_text_outside_the_current_ucs2_cmap() {
        let error = pdf_text_array("😀", &[4.0], 4.0, 4.0)
            .expect_err("non-BMP text should not be silently encoded");
        assert!(error.contains("U+1F600"));
        assert!(error.contains("UniJIS-UCS2-H"));
    }

    #[test]
    fn emits_exact_text_local_layout_for_multiline_rotated_mirrored_text() {
        let font_size_mm = 4.0;
        let line_height_mm = 4.8;
        let line_widths_mm = vec![4.96, 8.0];
        let line_advances_mm = vec![vec![2.48, 2.48], vec![4.0, 4.0]];
        let relative =
            text_bounds_relative(font_size_mm, &line_widths_mm, line_height_mm, 30.0, true);
        let text_payload = ResolvedPrintOutputPayload {
            version: 1,
            kind: "print".to_owned(),
            bounds: OutputBounds {
                min_x: 20.0 + relative.min_x,
                min_y: 30.0 + relative.min_y,
                max_x: 20.0 + relative.max_x,
                max_y: 30.0 + relative.max_y,
                width: relative.width,
                height: relative.height,
            },
            drawables: vec![OutputDrawable::Text {
                element_id: "text".to_owned(),
                name: "text".to_owned(),
                text: "AB\n日本".to_owned(),
                anchor: OutputPoint { x: 20.0, y: 30.0 },
                font_size_mm,
                width_mm: 8.0,
                line_widths_mm,
                line_advances_mm,
                line_height_mm,
                rotation_deg: 30.0,
                mirror_x: true,
                color_hex: "#336699".to_owned(),
            }],
            paper: crate::print_output::PaperSize {
                width_mm: 210.0,
                height_mm: 297.0,
            },
            margin_mm: 10.0,
            overlap_mm: 10.0,
            stride: OutputPoint { x: 180.0, y: 267.0 },
            pages: vec![OutputPrintPage {
                index: 0,
                column: 0,
                row: 0,
                origin: OutputPoint { x: 0.0, y: 0.0 },
                guides: vec![],
            }],
        };
        let pdf = build_print_pdf(&text_payload).expect("text PDF should build");
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.contains("/DW 1000"));
        assert!(text.contains(
            "BT 0.2 0.4 0.6 rg /F1 11.339 Tf -0.866 -0.5 -0.5 0.866 56.693 85.039 Tm [<0041> 380 <0042> 380] TJ ET"
        ));
        assert!(text.contains(
            "BT 0.2 0.4 0.6 rg /F1 11.339 Tf -0.866 -0.5 -0.5 0.866 63.496 73.256 Tm [<65E5> 0 <672C> 0] TJ ET"
        ));
        assert!(!text.contains("BT 0.2 0.4 0.6 RG"));
        assert!(!text.contains("FEFF"));
        assert!((text_payload.bounds.width - relative.width).abs() < 1e-9);
        assert!((text_payload.bounds.height - relative.height).abs() < 1e-9);
    }

    #[test]
    fn consumes_resolved_guide_center_and_keeps_label_off_the_guide_line() {
        let guide = OutputGuide {
            axis: "vertical".to_owned(),
            position_mm: 190.0,
            label: "1".to_owned(),
            label_font_size_mm: 1.0,
            label_rotation_deg: 90.0,
            label_center: OutputPoint { x: 195.0, y: 148.5 },
            label_width_mm: 0.62,
            label_advances_mm: vec![0.62],
        };
        let expected_anchor = centered_text_anchor(
            guide.label_center,
            guide.label_font_size_mm,
            &[guide.label_width_mm],
            guide.label_font_size_mm * OUTPUT_TEXT_LINE_HEIGHT,
            guide.label_rotation_deg,
            false,
        );
        let mut resolved = payload();
        resolved.pages[0].guides = vec![guide.clone()];
        resolved.pages[1].guides = vec![OutputGuide {
            position_mm: 20.0,
            label_center: OutputPoint { x: 15.0, y: 148.5 },
            ..guide
        }];
        let relative = text_bounds_relative(1.0, &[0.62], OUTPUT_TEXT_LINE_HEIGHT, 90.0, false);
        assert!((expected_anchor.x + (relative.min_x + relative.max_x) / 2.0 - 195.0).abs() < 1e-9);
        assert!((expected_anchor.y + (relative.min_y + relative.max_y) / 2.0 - 148.5).abs() < 1e-9);
        let pdf = build_print_pdf(&resolved).expect("resolved guide center should build");
        let text = String::from_utf8_lossy(&pdf);
        let expected_text_marker = format!(
            "BT 0.192 0.196 0.184 rg /F1 2.835 Tf 0 1 -1 0 {} {} Tm [<0031> 380] TJ ET",
            pdf_number(pt(expected_anchor.x)),
            pdf_number(pt(expected_anchor.y))
        );
        assert!(text.contains(&expected_text_marker));
    }
}
