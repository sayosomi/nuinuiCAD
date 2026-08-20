use serde::Deserialize;

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct OutputPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OutputStroke {
    pub width_mm: f64,
    pub style: String,
    pub color_hex: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OutputPathSegment {
    Line {
        start: OutputPoint,
        end: OutputPoint,
    },
    Bezier {
        start: OutputPoint,
        control1: OutputPoint,
        control2: OutputPoint,
        end: OutputPoint,
    },
    Arc {
        center: OutputPoint,
        radius: f64,
        start_angle_deg: f64,
        sweep_angle_deg: f64,
    },
}

#[derive(Debug, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OutputDrawable {
    Line {
        element_id: String,
        name: String,
        start: OutputPoint,
        end: OutputPoint,
        stroke: OutputStroke,
    },
    Bezier {
        element_id: String,
        name: String,
        start: OutputPoint,
        control1: OutputPoint,
        control2: OutputPoint,
        end: OutputPoint,
        stroke: OutputStroke,
    },
    Arc {
        element_id: String,
        name: String,
        center: OutputPoint,
        radius: f64,
        start_angle_deg: f64,
        sweep_angle_deg: f64,
        stroke: OutputStroke,
    },
    OffsetLine {
        element_id: String,
        name: String,
        segments: Vec<OutputPathSegment>,
        stroke: OutputStroke,
    },
    Text {
        element_id: String,
        name: String,
        text: String,
        anchor: OutputPoint,
        font_size_mm: f64,
        width_mm: f64,
        line_height_mm: f64,
        rotation_deg: f64,
        mirror_x: bool,
        color_hex: String,
    },
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct OutputBounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OutputGuide {
    pub axis: String,
    pub position_mm: f64,
    pub label: String,
    pub label_font_size_mm: f64,
    pub label_rotation_deg: f64,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OutputPrintPage {
    pub index: usize,
    pub column: usize,
    pub row: usize,
    pub origin: OutputPoint,
    pub guides: Vec<OutputGuide>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSvgOutputPayload {
    pub version: u32,
    pub kind: String,
    pub bounds: OutputBounds,
    pub drawables: Vec<OutputDrawable>,
    pub width_mm: f64,
    pub height_mm: f64,
    pub content_origin: OutputPoint,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPrintOutputPayload {
    pub version: u32,
    pub kind: String,
    pub bounds: OutputBounds,
    pub drawables: Vec<OutputDrawable>,
    pub paper: PaperSize,
    pub margin_mm: f64,
    pub overlap_mm: f64,
    pub stride: OutputPoint,
    pub pages: Vec<OutputPrintPage>,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct PaperSize {
    pub width_mm: f64,
    pub height_mm: f64,
}

fn valid_hex(value: &str) -> bool {
    value.len() == 7
        && value.as_bytes()[0] == b'#'
        && value.as_bytes()[1..]
            .iter()
            .all(|byte| byte.is_ascii_hexdigit())
}

fn finite(value: f64, label: &str) -> Result<(), String> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(format!("{label} must be finite"))
    }
}

fn positive(value: f64, label: &str) -> Result<(), String> {
    finite(value, label)?;
    if value > 0.0 {
        Ok(())
    } else {
        Err(format!("{label} must be greater than zero"))
    }
}

fn non_negative(value: f64, label: &str) -> Result<(), String> {
    finite(value, label)?;
    if value >= 0.0 {
        Ok(())
    } else {
        Err(format!("{label} must be non-negative"))
    }
}

fn validate_point(point: OutputPoint, label: &str) -> Result<(), String> {
    finite(point.x, &format!("{label}.x"))?;
    finite(point.y, &format!("{label}.y"))
}

fn validate_stroke(stroke: &OutputStroke) -> Result<(), String> {
    positive(stroke.width_mm, "stroke width")?;
    if !matches!(stroke.style.as_str(), "solid" | "dashed" | "dotted") {
        return Err(format!("unsupported stroke style: {}", stroke.style));
    }
    if !valid_hex(&stroke.color_hex) {
        return Err(format!("invalid stroke color: {}", stroke.color_hex));
    }
    Ok(())
}

fn validate_segment(segment: &OutputPathSegment) -> Result<(), String> {
    match segment {
        OutputPathSegment::Line { start, end } => {
            validate_point(*start, "segment.start")?;
            validate_point(*end, "segment.end")?;
        }
        OutputPathSegment::Bezier {
            start,
            control1,
            control2,
            end,
        } => {
            validate_point(*start, "segment.start")?;
            validate_point(*control1, "segment.control1")?;
            validate_point(*control2, "segment.control2")?;
            validate_point(*end, "segment.end")?;
        }
        OutputPathSegment::Arc {
            center,
            radius,
            start_angle_deg,
            sweep_angle_deg,
        } => {
            validate_point(*center, "segment.center")?;
            positive(*radius, "segment radius")?;
            finite(*start_angle_deg, "segment start angle")?;
            finite(*sweep_angle_deg, "segment sweep")?;
        }
    }
    Ok(())
}

fn validate_drawable(drawable: &OutputDrawable) -> Result<(), String> {
    match drawable {
        OutputDrawable::Line {
            start, end, stroke, ..
        } => {
            validate_point(*start, "line.start")?;
            validate_point(*end, "line.end")?;
            validate_stroke(stroke)?;
        }
        OutputDrawable::Bezier {
            start,
            control1,
            control2,
            end,
            stroke,
            ..
        } => {
            validate_point(*start, "bezier.start")?;
            validate_point(*control1, "bezier.control1")?;
            validate_point(*control2, "bezier.control2")?;
            validate_point(*end, "bezier.end")?;
            validate_stroke(stroke)?;
        }
        OutputDrawable::Arc {
            center,
            radius,
            start_angle_deg,
            sweep_angle_deg,
            stroke,
            ..
        } => {
            validate_point(*center, "arc.center")?;
            positive(*radius, "arc radius")?;
            finite(*start_angle_deg, "arc start angle")?;
            finite(*sweep_angle_deg, "arc sweep")?;
            validate_stroke(stroke)?;
        }
        OutputDrawable::OffsetLine {
            segments, stroke, ..
        } => {
            if segments.is_empty() {
                return Err("offsetLine must contain at least one segment".to_owned());
            }
            for segment in segments {
                validate_segment(segment)?;
            }
            validate_stroke(stroke)?;
        }
        OutputDrawable::Text {
            anchor,
            font_size_mm,
            width_mm,
            line_height_mm,
            rotation_deg,
            color_hex,
            ..
        } => {
            validate_point(*anchor, "text.anchor")?;
            positive(*font_size_mm, "text font size")?;
            non_negative(*width_mm, "text width")?;
            positive(*line_height_mm, "text line height")?;
            finite(*rotation_deg, "text rotation")?;
            if !valid_hex(color_hex) {
                return Err(format!("invalid text color: {color_hex}"));
            }
        }
    }
    Ok(())
}

fn validate_bounds(bounds: &OutputBounds) -> Result<(), String> {
    finite(bounds.min_x, "bounds.minX")?;
    finite(bounds.min_y, "bounds.minY")?;
    finite(bounds.max_x, "bounds.maxX")?;
    finite(bounds.max_y, "bounds.maxY")?;
    positive(bounds.width, "bounds.width")?;
    positive(bounds.height, "bounds.height")?;
    if bounds.max_x < bounds.min_x || bounds.max_y < bounds.min_y {
        return Err("bounds max must not be smaller than min".to_owned());
    }
    if (bounds.width - (bounds.max_x - bounds.min_x)).abs() > 1e-6
        || (bounds.height - (bounds.max_y - bounds.min_y)).abs() > 1e-6
    {
        return Err("bounds width/height do not match min/max".to_owned());
    }
    Ok(())
}

fn validate_common(
    version: u32,
    kind: &str,
    expected_kind: &str,
    bounds: &OutputBounds,
    drawables: &[OutputDrawable],
) -> Result<(), String> {
    if version != 1 {
        return Err(format!("unsupported output payload version: {version}"));
    }
    if kind != expected_kind {
        return Err(format!("expected {expected_kind} output payload"));
    }
    validate_bounds(bounds)?;
    if drawables.is_empty() {
        return Err("output payload must contain at least one drawable".to_owned());
    }
    for drawable in drawables {
        validate_drawable(drawable)?;
    }
    Ok(())
}

pub fn validate_svg_payload(payload: &ResolvedSvgOutputPayload) -> Result<(), String> {
    validate_common(
        payload.version,
        &payload.kind,
        "svg",
        &payload.bounds,
        &payload.drawables,
    )?;
    positive(payload.width_mm, "SVG width")?;
    positive(payload.height_mm, "SVG height")?;
    validate_point(payload.content_origin, "SVG content origin")
}

pub fn validate_print_payload(payload: &ResolvedPrintOutputPayload) -> Result<(), String> {
    validate_common(
        payload.version,
        &payload.kind,
        "print",
        &payload.bounds,
        &payload.drawables,
    )?;
    positive(payload.paper.width_mm, "paper width")?;
    positive(payload.paper.height_mm, "paper height")?;
    non_negative(payload.margin_mm, "print margin")?;
    non_negative(payload.overlap_mm, "print overlap")?;
    let effective_width = payload.paper.width_mm - 2.0 * payload.margin_mm;
    let effective_height = payload.paper.height_mm - 2.0 * payload.margin_mm;
    positive(effective_width, "effective paper width")?;
    positive(effective_height, "effective paper height")?;
    if payload.overlap_mm >= effective_width || payload.overlap_mm >= effective_height {
        return Err("print overlap must be smaller than the effective paper dimensions".to_owned());
    }
    if (payload.stride.x - (effective_width - payload.overlap_mm)).abs() > 1e-6
        || (payload.stride.y - (effective_height - payload.overlap_mm)).abs() > 1e-6
    {
        return Err("print stride does not match effective area and overlap".to_owned());
    }
    positive(payload.stride.x, "print x stride")?;
    positive(payload.stride.y, "print y stride")?;
    if payload.pages.is_empty() {
        return Err("print payload must contain at least one page".to_owned());
    }
    let columns = payload
        .pages
        .iter()
        .map(|page| page.column)
        .max()
        .unwrap_or(0)
        + 1;
    let rows = payload.pages.iter().map(|page| page.row).max().unwrap_or(0) + 1;
    for (expected_index, page) in payload.pages.iter().enumerate() {
        if page.index != expected_index {
            return Err("print pages must be in deterministic page order".to_owned());
        }
        validate_point(page.origin, "page origin")?;
        if expected_index > 0 {
            let previous = &payload.pages[expected_index - 1];
            let expected_order = if page.row == previous.row {
                page.column == previous.column + 1
            } else {
                page.row == previous.row + 1 && page.column == 0
            };
            if !expected_order {
                return Err(
                    "print pages must be ordered lower-left to right, then upward".to_owned(),
                );
            }
        }
        for guide in &page.guides {
            if !matches!(guide.axis.as_str(), "vertical" | "horizontal") {
                return Err(format!("unsupported guide axis: {}", guide.axis));
            }
            finite(guide.position_mm, "guide position")?;
            if guide.label.is_empty() {
                return Err("joining labels must not be empty".to_owned());
            }
            positive(guide.label_font_size_mm, "joining label font size")?;
            finite(guide.label_rotation_deg, "joining label rotation")?;
            let valid_position = if guide.axis == "vertical" {
                let is_left =
                    (guide.position_mm - (payload.margin_mm + payload.overlap_mm)).abs() <= 1e-6;
                let is_right = (guide.position_mm
                    - (payload.paper.width_mm - payload.margin_mm - payload.overlap_mm))
                    .abs()
                    <= 1e-6;
                (is_left && page.column > 0) || (is_right && page.column + 1 < columns)
            } else {
                let is_bottom =
                    (guide.position_mm - (payload.margin_mm + payload.overlap_mm)).abs() <= 1e-6;
                let is_top = (guide.position_mm
                    - (payload.paper.height_mm - payload.margin_mm - payload.overlap_mm))
                    .abs()
                    <= 1e-6;
                (is_bottom && page.row > 0) || (is_top && page.row + 1 < rows)
            };
            if !valid_position {
                return Err(
                    "joining guide position is not derived from a neighboring page edge".to_owned(),
                );
            }
            let expected_rotation = if guide.axis == "vertical" { 90.0 } else { 0.0 };
            if (guide.label_rotation_deg - expected_rotation).abs() > 1e-6 {
                return Err("joining label rotation does not match its guide axis".to_owned());
            }
        }
    }
    Ok(())
}
