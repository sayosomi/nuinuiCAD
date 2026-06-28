use super::offset_bezier::approximate_bezier_length;
use super::offset_source_segments::{
    source_end, source_end_tangent, source_start, source_start_tangent,
};
use super::offset_types::{
    angle_of_point, line_length, positive_sweep_degrees, segment_end, segment_start, OffsetPoint,
    OffsetSegment, RawOffsetSegment, EPSILON,
};

const POINTED_JOIN_DOT_THRESHOLD: f64 = -0.95;
const POINTED_JOIN_MITER_FACTOR: f64 = 4.0;
const POINTED_JOIN_MAX_LENGTH: f64 = 200.0;

fn line_intersection(first: &OffsetSegment, second: &OffsetSegment) -> Option<OffsetPoint> {
    let (
        OffsetSegment::Line {
            start: first_start,
            end: first_end,
            ..
        },
        OffsetSegment::Line {
            start: second_start,
            end: second_end,
            ..
        },
    ) = (first, second)
    else {
        return None;
    };
    let x1 = first_start.x;
    let y1 = first_start.y;
    let x2 = first_end.x;
    let y2 = first_end.y;
    let x3 = second_start.x;
    let y3 = second_start.y;
    let x4 = second_end.x;
    let y4 = second_end.y;
    let denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if denominator.abs() <= EPSILON {
        return None;
    }
    Some(OffsetPoint {
        x: ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denominator,
        y: ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denominator,
    })
}

fn line_circle_intersections(line: &OffsetSegment, arc: &OffsetSegment) -> Vec<OffsetPoint> {
    let (OffsetSegment::Line { start, end, .. }, OffsetSegment::Arc { center, radius, .. }) =
        (line, arc)
    else {
        return Vec::new();
    };
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let fx = start.x - center.x;
    let fy = start.y - center.y;
    let a = dx * dx + dy * dy;
    if a <= EPSILON {
        return Vec::new();
    }
    let b = 2.0 * (fx * dx + fy * dy);
    let c = fx * fx + fy * fy - radius * radius;
    let discriminant = b * b - 4.0 * a * c;
    if discriminant < -EPSILON {
        return Vec::new();
    }
    if discriminant.abs() <= EPSILON {
        let t = -b / (2.0 * a);
        return vec![OffsetPoint {
            x: start.x + dx * t,
            y: start.y + dy * t,
        }];
    }
    let sqrt = discriminant.sqrt();
    [(-b + sqrt) / (2.0 * a), (-b - sqrt) / (2.0 * a)]
        .into_iter()
        .map(|t| OffsetPoint {
            x: start.x + dx * t,
            y: start.y + dy * t,
        })
        .collect()
}

fn circle_circle_intersections(first: &OffsetSegment, second: &OffsetSegment) -> Vec<OffsetPoint> {
    let (
        OffsetSegment::Arc {
            center: first_center,
            radius: first_radius,
            ..
        },
        OffsetSegment::Arc {
            center: second_center,
            radius: second_radius,
            ..
        },
    ) = (first, second)
    else {
        return Vec::new();
    };
    let dx = second_center.x - first_center.x;
    let dy = second_center.y - first_center.y;
    let distance = dx.hypot(dy);
    if distance <= EPSILON
        || distance > first_radius + second_radius + EPSILON
        || distance < (first_radius - second_radius).abs() - EPSILON
    {
        return Vec::new();
    }
    let a = (first_radius * first_radius - second_radius * second_radius + distance * distance)
        / (2.0 * distance);
    let height_squared = first_radius * first_radius - a * a;
    if height_squared < -EPSILON {
        return Vec::new();
    }
    let px = first_center.x + (a * dx) / distance;
    let py = first_center.y + (a * dy) / distance;
    if height_squared.abs() <= EPSILON {
        return vec![OffsetPoint { x: px, y: py }];
    }
    let height = height_squared.sqrt();
    vec![
        OffsetPoint {
            x: px + (-dy * height) / distance,
            y: py + (dx * height) / distance,
        },
        OffsetPoint {
            x: px - (-dy * height) / distance,
            y: py - (dx * height) / distance,
        },
    ]
}

fn nearest_point(
    points: impl IntoIterator<Item = OffsetPoint>,
    target_a: OffsetPoint,
    target_b: OffsetPoint,
) -> Option<OffsetPoint> {
    points.into_iter().min_by(|left, right| {
        let left_distance = line_length(*left, target_a) + line_length(*left, target_b);
        let right_distance = line_length(*right, target_a) + line_length(*right, target_b);
        left_distance.total_cmp(&right_distance)
    })
}

fn bezier_start_tangent_line(segment: &OffsetSegment) -> Option<OffsetSegment> {
    let OffsetSegment::Bezier {
        start, control1, ..
    } = segment
    else {
        return None;
    };
    let tangent = OffsetPoint {
        x: control1.x - start.x,
        y: control1.y - start.y,
    };
    let length = tangent.x.hypot(tangent.y);
    (length > EPSILON).then_some(OffsetSegment::Line {
        start: *start,
        end: OffsetPoint {
            x: start.x + tangent.x,
            y: start.y + tangent.y,
        },
        length,
    })
}

fn bezier_end_tangent_line(segment: &OffsetSegment) -> Option<OffsetSegment> {
    let OffsetSegment::Bezier { control2, end, .. } = segment else {
        return None;
    };
    let tangent = OffsetPoint {
        x: end.x - control2.x,
        y: end.y - control2.y,
    };
    let length = tangent.x.hypot(tangent.y);
    (length > EPSILON).then_some(OffsetSegment::Line {
        start: OffsetPoint {
            x: end.x - tangent.x,
            y: end.y - tangent.y,
        },
        end: *end,
        length,
    })
}

pub(crate) fn join_intersection(
    first: &OffsetSegment,
    second: &OffsetSegment,
) -> Option<OffsetPoint> {
    match (first, second) {
        (OffsetSegment::Line { .. }, OffsetSegment::Line { .. }) => nearest_point(
            line_intersection(first, second),
            segment_end(first),
            segment_start(second),
        ),
        (OffsetSegment::Line { .. }, OffsetSegment::Bezier { .. }) => {
            let tangent = bezier_start_tangent_line(second)?;
            nearest_point(
                line_intersection(first, &tangent),
                segment_end(first),
                segment_start(second),
            )
        }
        (OffsetSegment::Bezier { .. }, OffsetSegment::Line { .. }) => {
            let tangent = bezier_end_tangent_line(first)?;
            nearest_point(
                line_intersection(&tangent, second),
                segment_end(first),
                segment_start(second),
            )
        }
        (OffsetSegment::Bezier { .. }, OffsetSegment::Bezier { .. }) => {
            let first_tangent = bezier_end_tangent_line(first)?;
            let second_tangent = bezier_start_tangent_line(second)?;
            nearest_point(
                line_intersection(&first_tangent, &second_tangent),
                segment_end(first),
                segment_start(second),
            )
        }
        (OffsetSegment::Line { .. }, OffsetSegment::Arc { .. }) => nearest_point(
            line_circle_intersections(first, second),
            segment_end(first),
            segment_start(second),
        ),
        (OffsetSegment::Arc { .. }, OffsetSegment::Line { .. }) => nearest_point(
            line_circle_intersections(second, first),
            segment_end(first),
            segment_start(second),
        ),
        (OffsetSegment::Arc { .. }, OffsetSegment::Arc { .. }) => nearest_point(
            circle_circle_intersections(first, second),
            segment_end(first),
            segment_start(second),
        ),
        _ => None,
    }
}

pub(crate) fn with_start(segment: &OffsetSegment, point: OffsetPoint) -> OffsetSegment {
    match segment {
        OffsetSegment::Line { end, .. } => OffsetSegment::Line {
            start: point,
            end: *end,
            length: line_length(point, *end),
        },
        OffsetSegment::Bezier {
            start,
            control1,
            control2,
            end,
            ..
        } => {
            let dx = point.x - start.x;
            let dy = point.y - start.y;
            let mut next = OffsetSegment::Bezier {
                start: point,
                control1: OffsetPoint {
                    x: control1.x + dx,
                    y: control1.y + dy,
                },
                control2: *control2,
                end: *end,
                length: 0.0,
            };
            let length = approximate_bezier_length(&next);
            if let OffsetSegment::Bezier { length: item, .. } = &mut next {
                *item = length;
            }
            next
        }
        OffsetSegment::Arc {
            center,
            end,
            radius,
            sweep_angle_deg,
            ..
        } => {
            let start_angle_deg = angle_of_point(*center, point);
            let end_angle_deg = angle_of_point(*center, *end);
            let next_sweep_angle_deg = if *sweep_angle_deg >= 0.0 {
                positive_sweep_degrees(start_angle_deg, end_angle_deg)
            } else {
                -positive_sweep_degrees(end_angle_deg, start_angle_deg)
            };
            OffsetSegment::Arc {
                center: *center,
                start: point,
                end: *end,
                radius: *radius,
                start_angle_deg,
                sweep_angle_deg: next_sweep_angle_deg,
                length: radius * next_sweep_angle_deg.to_radians().abs(),
            }
        }
    }
}

pub(crate) fn with_end(segment: &OffsetSegment, point: OffsetPoint) -> OffsetSegment {
    match segment {
        OffsetSegment::Line { start, .. } => OffsetSegment::Line {
            start: *start,
            end: point,
            length: line_length(*start, point),
        },
        OffsetSegment::Bezier {
            start,
            control1,
            control2,
            end,
            ..
        } => {
            let dx = point.x - end.x;
            let dy = point.y - end.y;
            let mut next = OffsetSegment::Bezier {
                start: *start,
                control1: *control1,
                control2: OffsetPoint {
                    x: control2.x + dx,
                    y: control2.y + dy,
                },
                end: point,
                length: 0.0,
            };
            let length = approximate_bezier_length(&next);
            if let OffsetSegment::Bezier { length: item, .. } = &mut next {
                *item = length;
            }
            next
        }
        OffsetSegment::Arc {
            center,
            start,
            radius,
            start_angle_deg,
            sweep_angle_deg,
            ..
        } => {
            let end_angle_deg = angle_of_point(*center, point);
            let next_sweep_angle_deg = if *sweep_angle_deg >= 0.0 {
                positive_sweep_degrees(*start_angle_deg, end_angle_deg)
            } else {
                -positive_sweep_degrees(end_angle_deg, *start_angle_deg)
            };
            OffsetSegment::Arc {
                center: *center,
                start: *start,
                end: point,
                radius: *radius,
                start_angle_deg: *start_angle_deg,
                sweep_angle_deg: next_sweep_angle_deg,
                length: radius * next_sweep_angle_deg.to_radians().abs(),
            }
        }
    }
}

pub(crate) fn line_connector(
    start: OffsetPoint,
    end: OffsetPoint,
    _element_id: &str,
    _name: &str,
    _index: usize,
) -> Option<OffsetSegment> {
    (line_length(start, end) > EPSILON).then_some(OffsetSegment::Line {
        start,
        end,
        length: line_length(start, end),
    })
}

pub(crate) fn pointed_join_connectors(
    previous: &RawOffsetSegment,
    next: &RawOffsetSegment,
    offset: f64,
    element_id: &str,
    name: &str,
    index: usize,
) -> Vec<OffsetSegment> {
    let join_point = source_end(&previous.source);
    if line_length(join_point, source_start(&next.source)) > (offset.abs() * 0.01).max(0.1) {
        return Vec::new();
    }
    let Some(incoming) = source_end_tangent(&previous.source) else {
        return Vec::new();
    };
    let Some(outgoing) = source_start_tangent(&next.source) else {
        return Vec::new();
    };
    let dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
    if dot > POINTED_JOIN_DOT_THRESHOLD {
        return Vec::new();
    }
    let apex_distance = (offset.abs() * POINTED_JOIN_MITER_FACTOR).min(POINTED_JOIN_MAX_LENGTH);
    if apex_distance <= EPSILON {
        return Vec::new();
    }
    let apex = OffsetPoint {
        x: join_point.x + incoming.x * apex_distance,
        y: join_point.y + incoming.y * apex_distance,
    };
    [
        line_connector(
            segment_end(&previous.segment),
            apex,
            element_id,
            name,
            index * 2,
        ),
        line_connector(
            apex,
            segment_start(&next.segment),
            element_id,
            name,
            index * 2 + 1,
        ),
    ]
    .into_iter()
    .flatten()
    .collect()
}
