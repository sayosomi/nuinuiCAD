use serde::Deserialize;

pub(crate) const OUTPUT_TEXT_LINE_HEIGHT: f64 = 1.2;
pub(crate) const OUTPUT_TEXT_ASCENT: f64 = 0.8;
pub(crate) const OUTPUT_TEXT_DESCENT: f64 = 0.2;

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
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
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
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
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
    Polyline {
        element_id: String,
        name: String,
        segments: Vec<OutputPathSegment>,
        closed: bool,
        stroke: OutputStroke,
    },
    Text {
        element_id: String,
        name: String,
        text: String,
        anchor: OutputPoint,
        font_size_mm: f64,
        width_mm: f64,
        line_widths_mm: Vec<f64>,
        line_advances_mm: Vec<Vec<f64>>,
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
#[serde(deny_unknown_fields)]
pub struct OutputJoiningLabel {
    pub text: String,
    pub font_size_mm: f64,
    pub rotation_deg: f64,
    pub center: OutputPoint,
    pub width_mm: f64,
    pub advances_mm: Vec<f64>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct OutputGuide {
    pub axis: String,
    pub position_mm: f64,
    pub label: Option<OutputJoiningLabel>,
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
#[serde(deny_unknown_fields)]
pub struct ResolvedPrintOutputPayload {
    pub version: u32,
    pub kind: String,
    pub bounds: OutputBounds,
    pub drawables: Vec<OutputDrawable>,
    pub paper: PaperSize,
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

pub(crate) fn text_bounds_relative(
    font_size_mm: f64,
    line_widths_mm: &[f64],
    line_height_mm: f64,
    rotation_deg: f64,
    mirror_x: bool,
) -> OutputBounds {
    let angle = rotation_deg.to_radians();
    let sign = if mirror_x { -1.0 } else { 1.0 };
    let ascent = font_size_mm * OUTPUT_TEXT_ASCENT;
    let descent = font_size_mm * OUTPUT_TEXT_DESCENT;
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for (index, width) in line_widths_mm.iter().enumerate() {
        let baseline_y = -(index as f64) * line_height_mm;
        for (local_x, local_y) in [
            (0.0, baseline_y - descent),
            (*width, baseline_y - descent),
            (0.0, baseline_y + ascent),
            (*width, baseline_y + ascent),
        ] {
            let mirrored_x = local_x * sign;
            let x = mirrored_x * angle.cos() - local_y * angle.sin();
            let y = mirrored_x * angle.sin() + local_y * angle.cos();
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        }
    }
    OutputBounds {
        min_x,
        min_y,
        max_x,
        max_y,
        width: max_x - min_x,
        height: max_y - min_y,
    }
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

fn close_enough(left: f64, right: f64) -> bool {
    (left - right).abs() <= 1e-6
}

fn validate_text_layout(
    text: &str,
    font_size_mm: f64,
    width_mm: f64,
    line_widths_mm: &[f64],
    line_advances_mm: &[Vec<f64>],
    line_height_mm: f64,
    rotation_deg: f64,
) -> Result<(), String> {
    positive(font_size_mm, "text font size")?;
    non_negative(width_mm, "text width")?;
    positive(line_height_mm, "text line height")?;
    finite(rotation_deg, "text rotation")?;
    let lines = text.split('\n').collect::<Vec<_>>();
    if line_widths_mm.len() != lines.len() || line_advances_mm.len() != lines.len() {
        return Err("text line layout does not match text lines".to_owned());
    }
    let mut max_width: f64 = 0.0;
    for ((line, advances), width) in lines.iter().zip(line_advances_mm).zip(line_widths_mm) {
        if advances.len() != line.chars().count() {
            return Err("text glyph layout does not match text characters".to_owned());
        }
        let mut measured_width = 0.0;
        for advance in advances {
            non_negative(*advance, "text glyph advance")?;
            measured_width += *advance;
        }
        non_negative(*width, "text line width")?;
        if !close_enough(measured_width, *width) {
            return Err("text line width does not match glyph advances".to_owned());
        }
        max_width = max_width.max(*width);
    }
    if !close_enough(max_width, width_mm) {
        return Err("text width does not match the widest line".to_owned());
    }
    Ok(())
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
        OutputDrawable::Polyline {
            segments, stroke, ..
        } => {
            if segments.is_empty() {
                return Err("polyline must contain at least one segment".to_owned());
            }
            let mut previous_end: Option<OutputPoint> = None;
            for segment in segments {
                let OutputPathSegment::Line { start, end } = segment else {
                    return Err("polyline segments must be lines".to_owned());
                };
                validate_segment(segment)?;
                if let Some(previous) = previous_end {
                    if !close_enough(previous.x, start.x) || !close_enough(previous.y, start.y) {
                        return Err("polyline segments must be contiguous".to_owned());
                    }
                }
                previous_end = Some(*end);
            }
            validate_stroke(stroke)?;
        }
        OutputDrawable::Text {
            text,
            anchor,
            font_size_mm,
            width_mm,
            line_widths_mm,
            line_advances_mm,
            line_height_mm,
            rotation_deg,
            color_hex,
            ..
        } => {
            validate_point(*anchor, "text.anchor")?;
            validate_text_layout(
                text,
                *font_size_mm,
                *width_mm,
                line_widths_mm,
                line_advances_mm,
                *line_height_mm,
                *rotation_deg,
            )?;
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

fn page_at(pages: &[OutputPrintPage], column: usize, row: usize) -> Option<&OutputPrintPage> {
    pages
        .iter()
        .find(|page| page.column == column && page.row == row)
}

fn guide_at<'a>(
    page: &'a OutputPrintPage,
    axis: &str,
    position_mm: f64,
) -> Option<&'a OutputGuide> {
    page.guides
        .iter()
        .find(|guide| guide.axis == axis && close_enough(guide.position_mm, position_mm))
}

fn expected_label_center(
    axis: &str,
    position_mm: f64,
    paper: PaperSize,
    overlap_mm: f64,
) -> OutputPoint {
    if axis == "vertical" {
        if close_enough(position_mm, overlap_mm) {
            OutputPoint {
                x: overlap_mm / 2.0,
                y: paper.height_mm / 2.0,
            }
        } else {
            OutputPoint {
                x: paper.width_mm - overlap_mm / 2.0,
                y: paper.height_mm / 2.0,
            }
        }
    } else if close_enough(position_mm, overlap_mm) {
        OutputPoint {
            x: paper.width_mm / 2.0,
            y: overlap_mm / 2.0,
        }
    } else {
        OutputPoint {
            x: paper.width_mm / 2.0,
            y: paper.height_mm - overlap_mm / 2.0,
        }
    }
}

fn validate_joining_label(
    label: &OutputJoiningLabel,
    guide: &OutputGuide,
    paper: PaperSize,
    overlap_mm: f64,
) -> Result<(), String> {
    if label.text.is_empty() {
        return Err("joining labels must not be empty".to_owned());
    }
    positive(label.font_size_mm, "joining label font size")?;
    finite(label.rotation_deg, "joining label rotation")?;
    validate_point(label.center, "joining label center")?;
    non_negative(label.width_mm, "joining label width")?;
    let measured_label_width = label.advances_mm.iter().try_fold(0.0, |width, advance| {
        non_negative(*advance, "joining label glyph advance")?;
        Ok::<f64, String>(width + advance)
    })?;
    if label.advances_mm.len() != label.text.chars().count()
        || !close_enough(measured_label_width, label.width_mm)
    {
        return Err("joining label width does not match glyph advances".to_owned());
    }
    let expected_center = expected_label_center(&guide.axis, guide.position_mm, paper, overlap_mm);
    if !close_enough(label.center.x, expected_center.x)
        || !close_enough(label.center.y, expected_center.y)
    {
        return Err("joining label center is not resolved inside its overlap strip".to_owned());
    }
    let expected_rotation = if guide.axis == "vertical" { 90.0 } else { 0.0 };
    if (label.rotation_deg - expected_rotation).abs() > 1e-6 {
        return Err("joining label rotation does not match its guide axis".to_owned());
    }
    let label_bounds = text_bounds_relative(
        label.font_size_mm,
        &[label.width_mm],
        label.font_size_mm * OUTPUT_TEXT_LINE_HEIGHT,
        label.rotation_deg,
        false,
    );
    let strip_width = if guide.axis == "vertical" {
        overlap_mm
    } else {
        paper.width_mm
    };
    let strip_height = if guide.axis == "vertical" {
        paper.height_mm
    } else {
        overlap_mm
    };
    if label_bounds.width > strip_width + 1e-6 || label_bounds.height > strip_height + 1e-6 {
        return Err("joining label does not fit inside its overlap strip".to_owned());
    }
    Ok(())
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
    non_negative(payload.overlap_mm, "print overlap")?;
    let usable_width = payload.paper.width_mm - 2.0 * payload.overlap_mm;
    let usable_height = payload.paper.height_mm - 2.0 * payload.overlap_mm;
    positive(usable_width, "usable paper width")?;
    positive(usable_height, "usable paper height")?;
    let expected_stride = OutputPoint {
        x: usable_width,
        y: usable_height,
    };
    if (payload.stride.x - expected_stride.x).abs() > 1e-6
        || (payload.stride.y - expected_stride.y).abs() > 1e-6
    {
        return Err("print stride does not match paper size and physical overlap".to_owned());
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
        let expected_origin = OutputPoint {
            x: payload.bounds.min_x + page.column as f64 * payload.stride.x - payload.overlap_mm,
            y: payload.bounds.min_y + page.row as f64 * payload.stride.y - payload.overlap_mm,
        };
        if !close_enough(page.origin.x, expected_origin.x)
            || !close_enough(page.origin.y, expected_origin.y)
        {
            return Err("page origin does not match physical overlap and stride".to_owned());
        }
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
        if payload.overlap_mm == 0.0 && !page.guides.is_empty() {
            return Err("print overlap guides are not allowed when overlap is zero".to_owned());
        }
        if payload.overlap_mm > 0.0 && page.guides.len() != 4 {
            return Err(
                "print pages must contain four inset guides when overlap is positive".to_owned(),
            );
        }
        let mut seen_guides = [false; 4];
        for guide in &page.guides {
            if !matches!(guide.axis.as_str(), "vertical" | "horizontal") {
                return Err(format!("unsupported guide axis: {}", guide.axis));
            }
            finite(guide.position_mm, "guide position")?;
            let slot = if guide.axis == "vertical" {
                if close_enough(guide.position_mm, payload.overlap_mm) {
                    Some(0)
                } else if close_enough(
                    guide.position_mm,
                    payload.paper.width_mm - payload.overlap_mm,
                ) {
                    Some(1)
                } else {
                    None
                }
            } else if close_enough(guide.position_mm, payload.overlap_mm) {
                Some(2)
            } else if close_enough(
                guide.position_mm,
                payload.paper.height_mm - payload.overlap_mm,
            ) {
                Some(3)
            } else {
                None
            };
            let Some(slot) = slot else {
                return Err("guide position must be one of the four inset page edges".to_owned());
            };
            if seen_guides[slot] {
                return Err("print pages must not contain duplicate inset guides".to_owned());
            }
            seen_guides[slot] = true;
            let has_neighbor = match slot {
                0 => page.column > 0,
                1 => page.column + 1 < columns,
                2 => page.row > 0,
                3 => page.row + 1 < rows,
                _ => unreachable!(),
            };
            if guide.label.is_some() != has_neighbor {
                return Err("joining labels are only allowed on neighboring page edges".to_owned());
            }
            if let Some(label) = &guide.label {
                validate_joining_label(label, guide, payload.paper, payload.overlap_mm)?;
            }
        }
        if payload.overlap_mm > 0.0 && seen_guides.iter().any(|seen| !seen) {
            return Err("print pages must contain all four inset guides".to_owned());
        }
    }
    if payload.overlap_mm > 0.0 {
        for row in 0..rows {
            for column in 0..columns {
                let page = page_at(&payload.pages, column, row).ok_or_else(|| {
                    "print pages must form a complete rectangular grid".to_owned()
                })?;
                if column + 1 < columns {
                    let next = page_at(&payload.pages, column + 1, row).ok_or_else(|| {
                        "print pages must form a complete rectangular grid".to_owned()
                    })?;
                    let right = guide_at(
                        page,
                        "vertical",
                        payload.paper.width_mm - payload.overlap_mm,
                    )
                    .ok_or_else(|| "missing right guide for neighboring page pair".to_owned())?;
                    let left = guide_at(next, "vertical", payload.overlap_mm)
                        .ok_or_else(|| "missing left guide for neighboring page pair".to_owned())?;
                    let (Some(right_label), Some(left_label)) = (&right.label, &left.label) else {
                        return Err(
                            "neighboring vertical guides must both have joining labels".to_owned()
                        );
                    };
                    if right_label.text != left_label.text {
                        return Err(
                            "neighboring vertical guides must retain the same joining label"
                                .to_owned(),
                        );
                    }
                    if !close_enough(
                        page.origin.x + right.position_mm,
                        next.origin.x + left.position_mm,
                    ) {
                        return Err("neighboring vertical guides must coincide globally".to_owned());
                    }
                }
                if row + 1 < rows {
                    let next = page_at(&payload.pages, column, row + 1).ok_or_else(|| {
                        "print pages must form a complete rectangular grid".to_owned()
                    })?;
                    let top = guide_at(
                        page,
                        "horizontal",
                        payload.paper.height_mm - payload.overlap_mm,
                    )
                    .ok_or_else(|| "missing top guide for neighboring page pair".to_owned())?;
                    let bottom =
                        guide_at(next, "horizontal", payload.overlap_mm).ok_or_else(|| {
                            "missing bottom guide for neighboring page pair".to_owned()
                        })?;
                    let (Some(top_label), Some(bottom_label)) = (&top.label, &bottom.label) else {
                        return Err(
                            "neighboring horizontal guides must both have joining labels"
                                .to_owned(),
                        );
                    };
                    if top_label.text != bottom_label.text {
                        return Err(
                            "neighboring horizontal guides must retain the same joining label"
                                .to_owned(),
                        );
                    }
                    if !close_enough(
                        page.origin.y + top.position_mm,
                        next.origin.y + bottom.position_mm,
                    ) {
                        return Err(
                            "neighboring horizontal guides must coincide globally".to_owned()
                        );
                    }
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn validation_label(text: &str, center: OutputPoint) -> OutputJoiningLabel {
        OutputJoiningLabel {
            text: text.to_owned(),
            font_size_mm: 1.0,
            rotation_deg: 90.0,
            center,
            width_mm: 0.62,
            advances_mm: vec![0.62],
        }
    }

    fn validation_payload() -> ResolvedPrintOutputPayload {
        let stroke = OutputStroke {
            width_mm: 0.18,
            style: "solid".to_owned(),
            color_hex: "#31322f".to_owned(),
        };
        let guides = |column: usize| {
            vec![
                OutputGuide {
                    axis: "vertical".to_owned(),
                    position_mm: 10.0,
                    label: (column > 0)
                        .then(|| validation_label("1", OutputPoint { x: 5.0, y: 148.5 })),
                },
                OutputGuide {
                    axis: "vertical".to_owned(),
                    position_mm: 200.0,
                    label: (column == 0)
                        .then(|| validation_label("1", OutputPoint { x: 205.0, y: 148.5 })),
                },
                OutputGuide {
                    axis: "horizontal".to_owned(),
                    position_mm: 10.0,
                    label: None,
                },
                OutputGuide {
                    axis: "horizontal".to_owned(),
                    position_mm: 287.0,
                    label: None,
                },
            ]
        };
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
                stroke,
            }],
            paper: PaperSize {
                width_mm: 210.0,
                height_mm: 297.0,
            },
            overlap_mm: 10.0,
            stride: OutputPoint { x: 190.0, y: 277.0 },
            pages: vec![
                OutputPrintPage {
                    index: 0,
                    column: 0,
                    row: 0,
                    origin: OutputPoint { x: -10.0, y: -10.0 },
                    guides: guides(0),
                },
                OutputPrintPage {
                    index: 1,
                    column: 1,
                    row: 0,
                    origin: OutputPoint { x: 180.0, y: -10.0 },
                    guides: guides(1),
                },
            ],
        }
    }

    #[test]
    fn accepts_unlabeled_outer_guides_and_matching_shared_labels() {
        assert!(validate_print_payload(&validation_payload()).is_ok());
    }

    #[test]
    fn rejects_malformed_guide_and_label_metadata() {
        let mut missing_guide = validation_payload();
        missing_guide.pages[0].guides.pop();
        assert!(validate_print_payload(&missing_guide).is_err());

        let mut outer_label = validation_payload();
        outer_label.pages[0].guides[0].label =
            Some(validation_label("1", OutputPoint { x: 5.0, y: 148.5 }));
        assert!(validate_print_payload(&outer_label).is_err());

        let mut mismatched_labels = validation_payload();
        mismatched_labels.pages[1].guides[0]
            .label
            .as_mut()
            .expect("shared guide should have a label")
            .text = "2".to_owned();
        assert!(validate_print_payload(&mismatched_labels).is_err());
    }

    #[test]
    fn deserializes_actual_camel_case_print_payload_with_xy_stride_and_label_center() {
        let payload: ResolvedPrintOutputPayload = serde_json::from_value(json!({
            "version": 1,
            "kind": "print",
            "bounds": {
                "minX": 0.0,
                "minY": 0.0,
                "maxX": 100.0,
                "maxY": 80.0,
                "width": 100.0,
                "height": 80.0
            },
            "drawables": [],
            "paper": { "widthMm": 210.0, "heightMm": 297.0 },
            "overlapMm": 10.0,
            "stride": { "x": 190.0, "y": 277.0 },
            "pages": [{
                "index": 0,
                "column": 0,
                "row": 0,
                "origin": { "x": -10.0, "y": -10.0 },
                "guides": [{
                    "axis": "vertical",
                    "positionMm": 200.0,
                    "label": {
                        "text": "1",
                        "fontSizeMm": 1.0,
                        "rotationDeg": 90.0,
                        "center": { "x": 205.0, "y": 148.5 },
                        "widthMm": 0.62,
                        "advancesMm": [0.62]
                    }
                }]
            }]
        }))
        .expect("camelCase output payload should deserialize");

        assert_eq!(payload.stride.x, 190.0);
        assert_eq!(payload.stride.y, 277.0);
        let label = payload.pages[0].guides[0]
            .label
            .as_ref()
            .expect("shared guide should contain a label");
        assert_eq!(label.center.x, 205.0);
        assert_eq!(label.center.y, 148.5);
    }
}
