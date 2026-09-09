use super::math::{arc_tangent_angles, positive_sweep_degrees, CIRCLE_EPSILON};

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct StructuralPoint {
    pub(crate) x: f64,
    pub(crate) y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct StructuralSegment {
    pub(crate) start: StructuralPoint,
    pub(crate) end: StructuralPoint,
    pub(crate) length: f64,
    pub(crate) start_angle_deg: Option<f64>,
    pub(crate) end_angle_deg: Option<f64>,
    pub(crate) start_tangent_angle_deg: Option<f64>,
    pub(crate) end_tangent_angle_deg: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct StructuralArcLine {
    pub(crate) center: StructuralPoint,
    pub(crate) start: StructuralPoint,
    pub(crate) end: StructuralPoint,
    pub(crate) radius: f64,
    pub(crate) start_angle_deg: f64,
    pub(crate) end_angle_deg: f64,
    pub(crate) start_tangent_angle_deg: f64,
    pub(crate) end_tangent_angle_deg: f64,
    pub(crate) sweep_angle_deg: f64,
    pub(crate) length: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct StructuralPolylineSegment {
    pub(crate) start: StructuralPoint,
    pub(crate) end: StructuralPoint,
    pub(crate) length: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct StructuralPolyline {
    pub(crate) segments: Vec<StructuralPolylineSegment>,
    pub(crate) closed: bool,
    pub(crate) start: StructuralPoint,
    pub(crate) end: StructuralPoint,
    pub(crate) length: f64,
    pub(crate) start_tangent_angle_deg: Option<f64>,
    pub(crate) end_tangent_angle_deg: Option<f64>,
}

pub(crate) fn coordinate_geometry_kernel(x: f64, y: f64) -> StructuralPoint {
    StructuralPoint { x, y }
}

pub(crate) fn offset_point_geometry_kernel(
    from: StructuralPoint,
    dx: f64,
    dy: f64,
) -> StructuralPoint {
    StructuralPoint {
        x: from.x + dx,
        y: from.y + dy,
    }
}

fn angle_from_to(start: StructuralPoint, end: StructuralPoint) -> Option<f64> {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let length = dx.hypot(dy);
    (length > CIRCLE_EPSILON).then(|| {
        let normalized = dy.atan2(dx).to_degrees().rem_euclid(360.0);
        if normalized.abs() < CIRCLE_EPSILON || (360.0 - normalized).abs() < CIRCLE_EPSILON {
            0.0
        } else {
            normalized
        }
    })
}

pub(crate) fn segment_geometry_kernel(
    start: StructuralPoint,
    end: StructuralPoint,
) -> StructuralSegment {
    let start_angle_deg = angle_from_to(start, end);
    let end_angle_deg = angle_from_to(end, start);
    StructuralSegment {
        start,
        end,
        length: (end.x - start.x).hypot(end.y - start.y),
        start_angle_deg,
        end_angle_deg,
        start_tangent_angle_deg: start_angle_deg,
        end_tangent_angle_deg: end_angle_deg,
    }
}

pub(crate) fn polyline_geometry_kernel(
    points: &[StructuralPoint],
    closed: bool,
) -> Option<StructuralPolyline> {
    let minimum = if closed { 3 } else { 2 };
    if points.len() < minimum
        || points
            .iter()
            .any(|point| !point.x.is_finite() || !point.y.is_finite())
    {
        return None;
    }
    let mut segments = points
        .windows(2)
        .map(|pair| StructuralPolylineSegment {
            start: pair[0],
            end: pair[1],
            length: (pair[1].x - pair[0].x).hypot(pair[1].y - pair[0].y),
        })
        .collect::<Vec<_>>();
    let first = *points.first()?;
    let last = *points.last()?;
    if closed && (last.x - first.x).hypot(last.y - first.y) > CIRCLE_EPSILON {
        segments.push(StructuralPolylineSegment {
            start: last,
            end: first,
            length: (first.x - last.x).hypot(first.y - last.y),
        });
    }
    let first_nonzero = segments
        .iter()
        .find(|segment| segment.length > CIRCLE_EPSILON);
    let last_nonzero = segments
        .iter()
        .rev()
        .find(|segment| segment.length > CIRCLE_EPSILON);
    Some(StructuralPolyline {
        length: segments.iter().map(|segment| segment.length).sum(),
        start_tangent_angle_deg: first_nonzero
            .and_then(|segment| angle_from_to(segment.start, segment.end)),
        end_tangent_angle_deg: last_nonzero
            .and_then(|segment| angle_from_to(segment.end, segment.start)),
        segments,
        closed,
        start: first,
        end: if closed { first } else { last },
    })
}

pub(crate) fn direct_arc_geometry_kernel(
    center: StructuralPoint,
    radius: f64,
    start_angle_deg: f64,
    end_angle_deg: f64,
    direction: &str,
) -> StructuralArcLine {
    let sweep_angle_deg = if direction == "clockwise" {
        -positive_sweep_degrees(end_angle_deg, start_angle_deg)
    } else {
        positive_sweep_degrees(start_angle_deg, end_angle_deg)
    };
    let (start_tangent_angle_deg, end_tangent_angle_deg) =
        arc_tangent_angles(start_angle_deg, end_angle_deg, sweep_angle_deg);
    let start_angle_rad = start_angle_deg.to_radians();
    let end_angle_rad = end_angle_deg.to_radians();
    StructuralArcLine {
        center,
        start: StructuralPoint {
            x: center.x + start_angle_rad.cos() * radius,
            y: center.y + start_angle_rad.sin() * radius,
        },
        end: StructuralPoint {
            x: center.x + end_angle_rad.cos() * radius,
            y: center.y + end_angle_rad.sin() * radius,
        },
        radius,
        start_angle_deg,
        end_angle_deg,
        start_tangent_angle_deg,
        end_tangent_angle_deg,
        sweep_angle_deg,
        length: radius * sweep_angle_deg.to_radians().abs(),
    }
}

pub(crate) fn through_arc_geometry_kernel(
    point1: StructuralPoint,
    point2: StructuralPoint,
    point3: StructuralPoint,
    start_angle_deg: f64,
    end_angle_deg: f64,
) -> Option<StructuralArcLine> {
    let denominator = 2.0
        * (point1.x * (point2.y - point3.y)
            + point2.x * (point3.y - point1.y)
            + point3.x * (point1.y - point2.y));
    if denominator.abs() < CIRCLE_EPSILON {
        return None;
    }

    let point1_squared = point1.x * point1.x + point1.y * point1.y;
    let point2_squared = point2.x * point2.x + point2.y * point2.y;
    let point3_squared = point3.x * point3.x + point3.y * point3.y;
    let center_x = (point1_squared * (point2.y - point3.y)
        + point2_squared * (point3.y - point1.y)
        + point3_squared * (point1.y - point2.y))
        / denominator;
    let center_y = (point1_squared * (point3.x - point2.x)
        + point2_squared * (point1.x - point3.x)
        + point3_squared * (point2.x - point1.x))
        / denominator;
    let radius = (point1.x - center_x).hypot(point1.y - center_y);

    if !center_x.is_finite()
        || !center_y.is_finite()
        || !radius.is_finite()
        || radius <= CIRCLE_EPSILON
    {
        return None;
    }
    Some(direct_arc_geometry_kernel(
        StructuralPoint {
            x: center_x,
            y: center_y,
        },
        radius,
        start_angle_deg,
        end_angle_deg,
        "counterclockwise",
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        coordinate_geometry_kernel, direct_arc_geometry_kernel, polyline_geometry_kernel,
        segment_geometry_kernel, through_arc_geometry_kernel, StructuralPoint,
    };

    #[test]
    fn structural_segment_is_identity_free_and_deterministic() {
        let start = coordinate_geometry_kernel(0.0, 0.0);
        let end = coordinate_geometry_kernel(3.0, 4.0);
        assert_eq!(
            segment_geometry_kernel(start, end),
            super::StructuralSegment {
                start: StructuralPoint { x: 0.0, y: 0.0 },
                end: StructuralPoint { x: 3.0, y: 4.0 },
                length: 5.0,
                start_angle_deg: Some(53.13010235415598),
                end_angle_deg: Some(233.13010235415598),
                start_tangent_angle_deg: Some(53.13010235415598),
                end_tangent_angle_deg: Some(233.13010235415598),
            }
        );
    }

    #[test]
    fn structural_direct_arc_is_identity_free_and_directional() {
        let arc = direct_arc_geometry_kernel(
            coordinate_geometry_kernel(0.0, 0.0),
            10.0,
            0.0,
            90.0,
            "clockwise",
        );
        assert_eq!(arc.start, StructuralPoint { x: 10.0, y: 0.0 });
        assert!(arc.end.x.abs() < 1e-12);
        assert!((arc.end.y - 10.0).abs() < 1e-12);
        assert_eq!(arc.sweep_angle_deg, -270.0);
        assert_eq!(arc.length, 10.0 * 270.0_f64.to_radians());
    }

    #[test]
    fn structural_through_arc_solves_a_circle_and_is_identity_free() {
        let arc = through_arc_geometry_kernel(
            coordinate_geometry_kernel(10.0, 0.0),
            coordinate_geometry_kernel(0.0, 10.0),
            coordinate_geometry_kernel(-10.0, 0.0),
            30.0,
            120.0,
        )
        .expect("three non-collinear points define a circle");

        assert!(arc.center.x.abs() < 1e-12);
        assert!(arc.center.y.abs() < 1e-12);
        assert!((arc.radius - 10.0).abs() < 1e-12);
        assert_eq!(arc.start_angle_deg, 30.0);
        assert_eq!(arc.end_angle_deg, 120.0);
        assert_eq!(arc.sweep_angle_deg, 90.0);
        assert_eq!(arc.length, 10.0 * 90.0_f64.to_radians());
        assert!((arc.start.x - 10.0 * 30.0_f64.to_radians().cos()).abs() < 1e-12);
        assert!((arc.end.y - 10.0 * 120.0_f64.to_radians().sin()).abs() < 1e-12);
    }

    #[test]
    fn structural_through_arc_rejects_duplicate_and_collinear_points() {
        let duplicate = through_arc_geometry_kernel(
            coordinate_geometry_kernel(0.0, 0.0),
            coordinate_geometry_kernel(0.0, 0.0),
            coordinate_geometry_kernel(1.0, 1.0),
            0.0,
            90.0,
        );
        let collinear = through_arc_geometry_kernel(
            coordinate_geometry_kernel(0.0, 0.0),
            coordinate_geometry_kernel(1.0, 1.0),
            coordinate_geometry_kernel(2.0, 2.0),
            0.0,
            90.0,
        );

        assert!(duplicate.is_none());
        assert!(collinear.is_none());
    }

    #[test]
    fn structural_polyline_preserves_open_and_closed_geometry() {
        let points = [
            coordinate_geometry_kernel(0.0, 0.0),
            coordinate_geometry_kernel(3.0, 4.0),
            coordinate_geometry_kernel(3.0, 0.0),
        ];
        let open = polyline_geometry_kernel(&points, false).expect("open polyline");
        assert_eq!(open.segments.len(), 2);
        assert_eq!(open.length, 9.0);
        assert_eq!(open.end, points[2]);
        let closed = polyline_geometry_kernel(&points, true).expect("closed polyline");
        assert_eq!(closed.segments.len(), 3);
        assert_eq!(closed.length, 12.0);
        assert_eq!(closed.end, points[0]);
    }
}
