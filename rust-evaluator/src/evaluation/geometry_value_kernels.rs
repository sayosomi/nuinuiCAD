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

pub(crate) fn coordinate_geometry_kernel(x: f64, y: f64) -> StructuralPoint {
    StructuralPoint { x, y }
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

#[cfg(test)]
mod tests {
    use super::{coordinate_geometry_kernel, direct_arc_geometry_kernel, segment_geometry_kernel, StructuralPoint};

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
}
