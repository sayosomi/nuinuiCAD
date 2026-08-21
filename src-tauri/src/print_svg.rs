use crate::print_output::{
    validate_svg_payload, OutputDrawable, OutputPathSegment, OutputPoint, OutputStroke,
    ResolvedSvgOutputPayload,
};
use serde::Deserialize;
use std::fs;

const OUTPUT_TEXT_FONT_FAMILY: &str = "HeiseiKakuGo-W5";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPrintSvgInput {
    path: String,
    payload: ResolvedSvgOutputPayload,
}

#[tauri::command]
pub fn export_print_svg(input: ExportPrintSvgInput) -> Result<(), String> {
    let svg = build_print_svg(&input.payload)?;
    fs::write(&input.path, svg).map_err(|error| format!("SVGを書き出せません: {error}"))
}

fn svg_number(value: f64) -> String {
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

fn svg_point(point: OutputPoint, payload: &ResolvedSvgOutputPayload) -> (String, String) {
    (
        svg_number(point.x - payload.content_origin.x),
        svg_number(payload.height_mm - (point.y - payload.content_origin.y)),
    )
}

fn path_data(segment: &OutputPathSegment, payload: &ResolvedSvgOutputPayload) -> Option<String> {
    match segment {
        OutputPathSegment::Line { start, end } => {
            let (x1, y1) = svg_point(*start, payload);
            let (x2, y2) = svg_point(*end, payload);
            Some(format!("M {x1} {y1} L {x2} {y2}"))
        }
        OutputPathSegment::Bezier {
            start,
            control1,
            control2,
            end,
        } => {
            let (x1, y1) = svg_point(*start, payload);
            let (c1x, c1y) = svg_point(*control1, payload);
            let (c2x, c2y) = svg_point(*control2, payload);
            let (x2, y2) = svg_point(*end, payload);
            Some(format!("M {x1} {y1} C {c1x} {c1y} {c2x} {c2y} {x2} {y2}"))
        }
        OutputPathSegment::Arc {
            center,
            radius,
            start_angle_deg,
            sweep_angle_deg,
        } => {
            let count = (sweep_angle_deg.abs() / 180.0).ceil().max(1.0) as usize;
            let delta = sweep_angle_deg / count as f64;
            let mut data = String::new();
            for index in 0..count {
                let start_angle = (start_angle_deg + index as f64 * delta).to_radians();
                let end_angle = (start_angle_deg + (index + 1) as f64 * delta).to_radians();
                let start = OutputPoint {
                    x: center.x + radius * start_angle.cos(),
                    y: center.y + radius * start_angle.sin(),
                };
                let end = OutputPoint {
                    x: center.x + radius * end_angle.cos(),
                    y: center.y + radius * end_angle.sin(),
                };
                let (x1, y1) = svg_point(start, payload);
                let (x2, y2) = svg_point(end, payload);
                let large_arc = if delta.abs() > 180.0 { 1 } else { 0 };
                let sweep = if *sweep_angle_deg < 0.0 { 1 } else { 0 };
                if index == 0 {
                    data.push_str(&format!("M {x1} {y1} "));
                }
                data.push_str(&format!(
                    "A {} {} 0 {large_arc} {sweep} {x2} {y2} ",
                    svg_number(*radius),
                    svg_number(*radius)
                ));
            }
            Some(data.trim_end().to_owned())
        }
    }
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn dash_attributes(stroke: &OutputStroke) -> String {
    match stroke.style.as_str() {
        "solid" => String::new(),
        "dashed" => r#" stroke-dasharray="4 3""#.to_owned(),
        "dotted" => r#" stroke-dasharray="1 2""#.to_owned(),
        _ => String::new(),
    }
}

fn push_path(
    svg: &mut String,
    segment: &OutputPathSegment,
    stroke: &OutputStroke,
    payload: &ResolvedSvgOutputPayload,
) {
    if let Some(data) = path_data(segment, payload) {
        svg.push_str(&format!(
            r##"    <path d="{data}" fill="none" stroke="{}" stroke-width="{}" stroke-linecap="round" stroke-linejoin="round"{} />"##,
            escape_xml(&stroke.color_hex),
            svg_number(stroke.width_mm),
            dash_attributes(stroke)
        ));
        svg.push('\n');
    }
}

fn push_drawable(svg: &mut String, drawable: &OutputDrawable, payload: &ResolvedSvgOutputPayload) {
    match drawable {
        OutputDrawable::Line {
            start, end, stroke, ..
        } => push_path(
            svg,
            &OutputPathSegment::Line {
                start: *start,
                end: *end,
            },
            stroke,
            payload,
        ),
        OutputDrawable::Bezier {
            start,
            control1,
            control2,
            end,
            stroke,
            ..
        } => push_path(
            svg,
            &OutputPathSegment::Bezier {
                start: *start,
                control1: *control1,
                control2: *control2,
                end: *end,
            },
            stroke,
            payload,
        ),
        OutputDrawable::Arc {
            center,
            radius,
            start_angle_deg,
            sweep_angle_deg,
            stroke,
            ..
        } => push_path(
            svg,
            &OutputPathSegment::Arc {
                center: *center,
                radius: *radius,
                start_angle_deg: *start_angle_deg,
                sweep_angle_deg: *sweep_angle_deg,
            },
            stroke,
            payload,
        ),
        OutputDrawable::OffsetLine {
            segments, stroke, ..
        } => {
            for segment in segments {
                push_path(svg, segment, stroke, payload);
            }
        }
        OutputDrawable::Text {
            text,
            anchor,
            font_size_mm,
            line_widths_mm,
            line_height_mm,
            rotation_deg,
            mirror_x,
            color_hex,
            ..
        } => {
            let (x, y) = svg_point(*anchor, payload);
            let mirror = if *mirror_x { -1 } else { 1 };
            svg.push_str(&format!(
                r##"    <text x="0" y="0" font-size="{}" fill="{}" font-family="{OUTPUT_TEXT_FONT_FAMILY}" dominant-baseline="alphabetic" transform="translate({x} {y}) rotate({} 0 0) scale({mirror} -1)">"##,
                svg_number(*font_size_mm),
                escape_xml(color_hex),
                svg_number(-*rotation_deg)
            ));
            for (index, (line, width)) in text.split('\n').zip(line_widths_mm).enumerate() {
                svg.push_str(&format!(
                    r#"<tspan x="0"{} textLength="{}" lengthAdjust="spacingAndGlyphs">{}</tspan>"#,
                    if index == 0 {
                        r#" y="0""#.to_owned()
                    } else {
                        format!(r#" dy="{}""#, svg_number(-*line_height_mm))
                    },
                    svg_number(*width),
                    escape_xml(line)
                ));
            }
            svg.push_str("</text>\n");
        }
    }
}

fn build_print_svg(payload: &ResolvedSvgOutputPayload) -> Result<String, String> {
    validate_svg_payload(payload)?;
    let width = svg_number(payload.width_mm);
    let height = svg_number(payload.height_mm);
    let mut svg = String::new();
    svg.push_str(r#"<?xml version="1.0" encoding="UTF-8"?>"#);
    svg.push('\n');
    svg.push_str(&format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}mm" height="{height}mm" viewBox="0 0 {width} {height}">"#
    ));
    svg.push('\n');
    for drawable in &payload.drawables {
        push_drawable(&mut svg, drawable, payload);
    }
    svg.push_str("</svg>\n");
    Ok(svg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::print_output::{text_bounds_relative, OutputBounds, OutputStroke};

    fn stroke() -> OutputStroke {
        OutputStroke {
            width_mm: 0.18,
            style: "solid".to_owned(),
            color_hex: "#31322f".to_owned(),
        }
    }

    fn payload() -> ResolvedSvgOutputPayload {
        ResolvedSvgOutputPayload {
            version: 1,
            kind: "svg".to_owned(),
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
                end: OutputPoint { x: 10.0, y: 20.0 },
                stroke: stroke(),
            }],
            width_mm: 100.0,
            height_mm: 80.0,
            content_origin: OutputPoint { x: 0.0, y: 0.0 },
        }
    }

    #[test]
    fn validates_payload_and_converts_y_axis_at_svg_boundary() {
        let svg = build_print_svg(&payload()).expect("svg should build");
        assert!(svg.contains(r#"width="100mm" height="80mm" viewBox="0 0 100 80""#));
        assert!(svg.contains(r#"d="M 0 80 L 10 60""#));
        assert!(svg.contains(r##"stroke="#31322f" stroke-width="0.18""##));
    }

    #[test]
    fn rejects_invalid_payload() {
        let mut invalid = payload();
        invalid.width_mm = 0.0;
        assert!(build_print_svg(&invalid).is_err());
    }

    #[test]
    fn emits_exact_text_local_layout_for_multiline_rotated_mirrored_text() {
        let font_size_mm = 4.0;
        let line_height_mm = 4.8;
        let line_widths_mm = vec![4.96, 8.0];
        let line_advances_mm = vec![vec![2.48, 2.48], vec![4.0, 4.0]];
        let relative =
            text_bounds_relative(font_size_mm, &line_widths_mm, line_height_mm, 30.0, true);
        let text_payload = ResolvedSvgOutputPayload {
            version: 1,
            kind: "svg".to_owned(),
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
                color_hex: "#31322f".to_owned(),
            }],
            width_mm: 100.0,
            height_mm: 80.0,
            content_origin: OutputPoint { x: 0.0, y: 0.0 },
        };
        let svg = build_print_svg(&text_payload).expect("text SVG should build");
        assert!(svg.contains(
            r##"font-family="HeiseiKakuGo-W5" dominant-baseline="alphabetic" transform="translate(20 50) rotate(-30 0 0) scale(-1 -1)""##
        ));
        assert!(svg.contains(
            r#"<tspan x="0" y="0" textLength="4.96" lengthAdjust="spacingAndGlyphs">AB</tspan>"#
        ));
        assert!(svg.contains(
            r#"<tspan x="0" dy="-4.8" textLength="8" lengthAdjust="spacingAndGlyphs">日本</tspan>"#
        ));
        assert!((text_payload.bounds.width - relative.width).abs() < 1e-9);
        assert!((text_payload.bounds.height - relative.height).abs() < 1e-9);
    }
}
