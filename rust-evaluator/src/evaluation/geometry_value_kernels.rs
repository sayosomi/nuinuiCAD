use super::math::CIRCLE_EPSILON;

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

#[cfg(test)]
mod tests {
    use super::{coordinate_geometry_kernel, segment_geometry_kernel, StructuralPoint};

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
}
