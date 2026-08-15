use serde_json::{json, Value};

// Shared pure math for cubic Bézier segments, reused by the split, intersection,
// and endpoint-move evaluators. Mirrors `src/geometry/bezierMath.ts`.

pub(crate) const EPSILON: f64 = 1e-9;

pub(crate) fn solve_real_quadratic(a: f64, b: f64, c: f64) -> Vec<f64> {
    if a.abs() <= EPSILON {
        if b.abs() <= EPSILON {
            return Vec::new();
        }
        return vec![-c / b];
    }

    let discriminant = b * b - 4.0 * a * c;
    if discriminant < -EPSILON {
        return Vec::new();
    }
    if discriminant.abs() <= EPSILON {
        return vec![-b / (2.0 * a)];
    }

    let root_distance = discriminant.sqrt();
    let mut roots = vec![
        (-b - root_distance) / (2.0 * a),
        (-b + root_distance) / (2.0 * a),
    ];
    roots.sort_by(|left, right| left.total_cmp(right));
    if (roots[1] - roots[0]).abs() <= EPSILON {
        vec![roots[0]]
    } else {
        roots
    }
}

#[derive(Clone, Copy)]
pub(crate) struct BezierFeatureCandidate {
    pub(crate) t: f64,
    pub(crate) score: f64,
}

pub(crate) fn select_best_bezier_feature_candidate(
    candidates: &[BezierFeatureCandidate],
) -> Option<BezierFeatureCandidate> {
    let mut best = None;
    for candidate in candidates {
        let Some(current) = best else {
            best = Some(*candidate);
            continue;
        };
        if candidate.score > current.score + EPSILON {
            best = Some(*candidate);
            continue;
        }
        if (candidate.score - current.score).abs() > EPSILON {
            continue;
        }

        let candidate_center_distance = (candidate.t - 0.5).abs();
        let current_center_distance = (current.t - 0.5).abs();
        if candidate_center_distance < current_center_distance - EPSILON
            || ((candidate_center_distance - current_center_distance).abs() <= EPSILON
                && candidate.t < current.t)
        {
            best = Some(*candidate);
        }
    }
    best
}

#[derive(Clone, Copy)]
pub(crate) struct Point {
    pub(crate) x: f64,
    pub(crate) y: f64,
}

pub(crate) struct BezierProjection {
    pub(crate) local_t: f64,
    pub(crate) distance_from_line: f64,
}

pub(crate) fn value_point(value: &Value) -> Option<Point> {
    Some(Point {
        x: value.get("x")?.as_f64()?,
        y: value.get("y")?.as_f64()?,
    })
}

pub(crate) fn distance(a: Point, b: Point) -> f64 {
    (b.x - a.x).hypot(b.y - a.y)
}

pub(crate) fn interpolate(start: Point, end: Point, t: f64) -> Point {
    Point {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
    }
}

pub(crate) fn dot(a: Point, b: Point) -> f64 {
    a.x * b.x + a.y * b.y
}

pub(crate) fn cubic_point(segment: &Value, t: f64) -> Option<Point> {
    let start = segment.get("start").and_then(value_point)?;
    let control1 = segment.get("control1").and_then(value_point)?;
    let control2 = segment.get("control2").and_then(value_point)?;
    let end = segment.get("end").and_then(value_point)?;
    let inverse = 1.0 - t;
    let a = inverse * inverse * inverse;
    let b = 3.0 * inverse * inverse * t;
    let c = 3.0 * inverse * t * t;
    let d = t * t * t;
    Some(Point {
        x: a * start.x + b * control1.x + c * control2.x + d * end.x,
        y: a * start.y + b * control1.y + c * control2.y + d * end.y,
    })
}

pub(crate) fn cubic_derivative(segment: &Value, t: f64) -> Option<Point> {
    let start = segment.get("start").and_then(value_point)?;
    let control1 = segment.get("control1").and_then(value_point)?;
    let control2 = segment.get("control2").and_then(value_point)?;
    let end = segment.get("end").and_then(value_point)?;
    let inverse = 1.0 - t;
    Some(Point {
        x: 3.0 * inverse * inverse * (control1.x - start.x)
            + 6.0 * inverse * t * (control2.x - control1.x)
            + 3.0 * t * t * (end.x - control2.x),
        y: 3.0 * inverse * inverse * (control1.y - start.y)
            + 6.0 * inverse * t * (control2.y - control1.y)
            + 3.0 * t * t * (end.y - control2.y),
    })
}

pub(crate) fn cubic_second_derivative(segment: &Value, t: f64) -> Option<Point> {
    let start = segment.get("start").and_then(value_point)?;
    let control1 = segment.get("control1").and_then(value_point)?;
    let control2 = segment.get("control2").and_then(value_point)?;
    let end = segment.get("end").and_then(value_point)?;
    Some(Point {
        x: 6.0 * (1.0 - t) * (control2.x - 2.0 * control1.x + start.x)
            + 6.0 * t * (end.x - 2.0 * control2.x + control1.x),
        y: 6.0 * (1.0 - t) * (control2.y - 2.0 * control1.y + start.y)
            + 6.0 * t * (end.y - 2.0 * control2.y + control1.y),
    })
}

// Newton projection of a point onto a cubic segment, seeded from an initial t.
pub(crate) fn refine_bezier_projection(
    segment: &Value,
    point: Point,
    initial_t: f64,
) -> Option<BezierProjection> {
    let mut t = initial_t.clamp(0.0, 1.0);
    for _ in 0..20 {
        let current = cubic_point(segment, t)?;
        let first = cubic_derivative(segment, t)?;
        let second = cubic_second_derivative(segment, t)?;
        let residual = Point {
            x: current.x - point.x,
            y: current.y - point.y,
        };
        let denominator = dot(first, first) + dot(residual, second);
        if denominator.abs() <= EPSILON {
            break;
        }

        let next_t = (t - dot(residual, first) / denominator).clamp(0.0, 1.0);
        if (next_t - t).abs() <= EPSILON {
            t = next_t;
            break;
        }
        t = next_t;
    }

    let projected = cubic_point(segment, t)?;
    Some(BezierProjection {
        local_t: t,
        distance_from_line: distance(point, projected),
    })
}

pub(crate) struct CurveProjection {
    pub(crate) segment_index: usize,
    pub(crate) local_t: f64,
    pub(crate) point: Point,
    pub(crate) distance: f64,
}

// Project a point onto the analytic curve made of cubic `segments`, returning
// the closest segment, its local parameter, the on-curve point, and distance.
// This is the single source of "where is this point on the curve" used by point
// placement, tangent lookup, and endpoint moves.
pub(crate) fn project_point_onto_curve(
    segments: &[Value],
    point: Point,
) -> Option<CurveProjection> {
    const SEED_STEPS: usize = 64;
    let mut best: Option<CurveProjection> = None;
    for (segment_index, segment) in segments.iter().enumerate() {
        let mut seed_t = 0.0;
        let mut seed_distance = f64::INFINITY;
        for index in 0..=SEED_STEPS {
            let t = index as f64 / SEED_STEPS as f64;
            let Some(sampled) = cubic_point(segment, t) else {
                continue;
            };
            let candidate = distance(sampled, point);
            if candidate < seed_distance {
                seed_distance = candidate;
                seed_t = t;
            }
        }
        let Some(refined) = refine_bezier_projection(segment, point, seed_t) else {
            continue;
        };
        if best.as_ref().map_or(true, |current| {
            refined.distance_from_line < current.distance
        }) {
            let Some(projected) = cubic_point(segment, refined.local_t) else {
                continue;
            };
            best = Some(CurveProjection {
                segment_index,
                local_t: refined.local_t,
                point: projected,
                distance: refined.distance_from_line,
            });
        }
    }
    best
}

// de Casteljau subdivision of a cubic at t. Returns the split point plus the
// `{control1, control2}` patches for the left (start→split) and right
// (split→end) halves, to be merged into caller-owned segment JSON.
pub(crate) fn split_bezier_like(segment: &Value, t: f64) -> Option<(Point, Value, Value)> {
    let start = segment.get("start").and_then(value_point)?;
    let control1 = segment.get("control1").and_then(value_point)?;
    let control2 = segment.get("control2").and_then(value_point)?;
    let end = segment.get("end").and_then(value_point)?;
    let p01 = interpolate(start, control1, t);
    let p12 = interpolate(control1, control2, t);
    let p23 = interpolate(control2, end, t);
    let p012 = interpolate(p01, p12, t);
    let p123 = interpolate(p12, p23, t);
    let p0123 = interpolate(p012, p123, t);
    Some((
        p0123,
        json!({
            "control1": { "x": p01.x, "y": p01.y },
            "control2": { "x": p012.x, "y": p012.y }
        }),
        json!({
            "control1": { "x": p123.x, "y": p123.y },
            "control2": { "x": p23.x, "y": p23.y }
        }),
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        select_best_bezier_feature_candidate, solve_real_quadratic, BezierFeatureCandidate,
    };

    #[test]
    fn solves_real_quadratic_roots_in_ascending_order() {
        assert_eq!(solve_real_quadratic(1.0, -3.0, 2.0), vec![1.0, 2.0]);
        assert_eq!(solve_real_quadratic(-1.0, 3.0, -2.0), vec![1.0, 2.0]);
    }

    #[test]
    fn handles_double_linear_constant_and_non_real_degenerations() {
        assert_eq!(solve_real_quadratic(1.0, -2.0, 1.0), vec![1.0]);
        assert_eq!(solve_real_quadratic(0.0, 2.0, -4.0), vec![2.0]);
        assert!(solve_real_quadratic(0.0, 0.0, 1.0).is_empty());
        assert!(solve_real_quadratic(1.0, 0.0, 1.0).is_empty());
    }

    #[test]
    fn treats_a_near_zero_discriminant_as_a_double_root() {
        assert_eq!(solve_real_quadratic(1.0, 2.0, 1.0 + 1e-10), vec![-1.0]);
    }

    #[test]
    fn applies_the_center_then_smaller_t_tie_break() {
        assert_eq!(
            select_best_bezier_feature_candidate(&[
                BezierFeatureCandidate { t: 0.0, score: 1.0 },
                BezierFeatureCandidate { t: 0.6, score: 1.0 },
            ])
            .unwrap()
            .t,
            0.6
        );
        assert_eq!(
            select_best_bezier_feature_candidate(&[
                BezierFeatureCandidate { t: 0.0, score: 1.0 },
                BezierFeatureCandidate { t: 1.0, score: 1.0 },
            ])
            .unwrap()
            .t,
            0.0
        );
    }
}
