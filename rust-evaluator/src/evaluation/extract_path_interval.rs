//! Directed interval extraction on the captured evaluated prefix. No source mutation.
use serde_json::{json, Value};

use super::bezier_math::{
    cubic_point, distance, interpolate, solve_real_quadratic, value_point, Point,
};
use super::bezier_path::approximate_segment_length;
use super::offset_types::offset_line_endpoint_measurements_from_values;
use super::path_reverse_geometry::reverse_line_like_geometry;
use super::point_anchor::computed_point;
use super::split_line_evaluator::split_offset_segment;

const EPS: f64 = 1e-9;
const TOLERANCE_MM: f64 = 0.001;

pub(crate) enum ExtractBoundary {
    Start,
    End,
    Point(Point),
}
#[derive(Debug, PartialEq)]
pub(crate) struct ExtractError {
    pub(crate) code: &'static str,
    pub(crate) boundary: Option<&'static str>,
}
#[derive(Debug)]
pub(crate) struct ExtractInterval {
    pub(crate) geometry: Value,
    pub(crate) left: (usize, f64),
    pub(crate) right: (usize, f64),
}
fn error(code: &'static str) -> ExtractError {
    ExtractError {
        code,
        boundary: None,
    }
}
fn field(v: &Value, key: &str) -> Option<f64> {
    v.get(key)?.as_f64().filter(|n| n.is_finite())
}
fn point_field(v: &Value, key: &str) -> Option<Point> {
    let p = value_point(v.get(key)?)?;
    (p.x.is_finite() && p.y.is_finite()).then_some(p)
}
fn point_value(p: Point) -> Value {
    computed_point(String::new(), String::new(), p.x, p.y)
}

fn cubic_roots(a: f64, b: f64, c: f64, d: f64) -> Vec<f64> {
    let value = |t: f64| ((a * t + b) * t + c) * t + d;
    let mut cuts = vec![0.0, 1.0];
    cuts.extend(
        solve_real_quadratic(3.0 * a, 2.0 * b, c)
            .into_iter()
            .filter(|t| *t > 0.0 && *t < 1.0),
    );
    cuts.sort_by(f64::total_cmp);
    let mut roots: Vec<f64> = cuts
        .iter()
        .copied()
        .filter(|t| value(*t).abs() <= 1e-10)
        .collect();
    for window in cuts.windows(2) {
        let (mut lo, mut hi) = (window[0], window[1]);
        if value(lo) * value(hi) >= 0.0 {
            continue;
        }
        for _ in 0..64 {
            let mid = (lo + hi) / 2.0;
            if value(lo) * value(mid) <= 0.0 {
                hi = mid;
            } else {
                lo = mid;
            }
        }
        roots.push((lo + hi) / 2.0);
    }
    roots.sort_by(f64::total_cmp);
    roots.dedup_by(|a, b| (*a - *b).abs() <= EPS);
    roots
}
fn point_at(s: &Value, t: f64) -> Option<Point> {
    match s.get("kind")?.as_str()? {
        "line" => Some(interpolate(
            point_field(s, "start")?,
            point_field(s, "end")?,
            t,
        )),
        "bezier" => cubic_point(s, t),
        "arc" => {
            let c = point_field(s, "center")?;
            let angle = (field(s, "startAngleDeg")? + field(s, "sweepAngleDeg")? * t).to_radians();
            let radius = field(s, "radius")?;
            Some(Point {
                x: c.x + radius * angle.cos(),
                y: c.y + radius * angle.sin(),
            })
        }
        _ => None,
    }
}
fn segment_stations(s: &Value, p: Point) -> Option<Vec<f64>> {
    if !p.x.is_finite() || !p.y.is_finite() {
        return Some(vec![]);
    }
    let start = point_field(s, "start")?;
    let end = point_field(s, "end")?;
    match s.get("kind")?.as_str()? {
        "line" => {
            let (dx, dy) = (end.x - start.x, end.y - start.y);
            let t = ((p.x - start.x) * dx + (p.y - start.y) * dy) / (dx * dx + dy * dy);
            Some(
                if (-EPS..=1.0 + EPS).contains(&t)
                    && distance(interpolate(start, end, t), p) <= TOLERANCE_MM
                {
                    vec![t.clamp(0.0, 1.0)]
                } else {
                    vec![]
                },
            )
        }
        "arc" => {
            let center = point_field(s, "center")?;
            if (distance(center, p) - field(s, "radius")?).abs() > TOLERANCE_MM {
                return Some(vec![]);
            }
            if distance(start, p) <= EPS {
                return Some(vec![0.0]);
            }
            if distance(end, p) <= EPS {
                return Some(vec![1.0]);
            }
            let angle = (p.y - center.y).atan2(p.x - center.x).to_degrees();
            let start_angle = field(s, "startAngleDeg")?;
            let sweep = field(s, "sweepAngleDeg")?;
            let normalize = |n: f64| ((n % 360.0) + 360.0) % 360.0;
            let progress = if sweep > 0.0 {
                normalize(angle - start_angle)
            } else {
                -normalize(start_angle - angle)
            };
            let t = progress / sweep;
            Some(if (-EPS..=1.0 + EPS).contains(&t) {
                vec![t.clamp(0.0, 1.0)]
            } else {
                vec![]
            })
        }
        "bezier" => {
            let c1 = point_field(s, "control1")?;
            let c2 = point_field(s, "control2")?;
            let coefficients = |s: f64, c1: f64, c2: f64, e: f64, p: f64| {
                [
                    -s + 3.0 * c1 - 3.0 * c2 + e,
                    3.0 * s - 6.0 * c1 + 3.0 * c2,
                    -3.0 * s + 3.0 * c1,
                    s - p,
                ]
            };
            let x = coefficients(start.x, c1.x, c2.x, end.x, p.x);
            let y = coefficients(start.y, c1.y, c2.y, end.y, p.y);
            let magnitude = |c: [f64; 4]| c[..3].iter().map(|n| n.abs()).fold(0.0, f64::max);
            let c = if magnitude(x) >= magnitude(y) { x } else { y };
            Some(
                cubic_roots(c[0], c[1], c[2], c[3])
                    .into_iter()
                    .filter(|t| cubic_point(s, *t).is_some_and(|q| distance(q, p) <= TOLERANCE_MM))
                    .collect(),
            )
        }
        _ => None,
    }
}
fn source_segments(source: &Value) -> Option<Vec<Value>> {
    let kind = source.get("kind")?.as_str()?;
    let values = match kind {
        "line" => vec![source.clone()],
        "arcLine" => {
            let mut s = source.clone();
            s["kind"] = json!("arc");
            vec![s]
        }
        "bezierCurve" | "polyline" | "offsetLine" | "joinedPath" => {
            source.get("segments")?.as_array()?.clone()
        }
        _ => return None,
    };
    values
        .into_iter()
        .map(|raw| {
            let mut s = json!({
                "kind": if kind == "bezierCurve" { "bezier" } else if kind == "polyline" { "line" } else { raw.get("kind")?.as_str()? },
                "start": raw.get("start")?, "end": raw.get("end")?
            });
            match s["kind"].as_str()? {
                "bezier" => { s["control1"] = raw.get("control1")?.clone(); s["control2"] = raw.get("control2")?.clone(); },
                "arc" => { for key in ["center", "radius", "startAngleDeg", "sweepAngleDeg"] { s[key] = raw.get(key)?.clone(); } },
                _ => {}
            }
            let start = point_field(&s, "start")?;
            let end = point_field(&s, "end")?;
            s["start"] = if s["start"].get("elementId").is_some() {
                s["start"].clone()
            } else {
                point_value(start)
            };
            s["end"] = if s["end"].get("elementId").is_some() {
                s["end"].clone()
            } else {
                point_value(end)
            };
            if kind == "bezierCurve" {
                s["kind"] = json!("bezier");
            }
            let length = match s.get("kind")?.as_str()? {
                "line" => distance(start, end),
                "bezier" => {
                    point_field(&s, "control1")?;
                    point_field(&s, "control2")?;
                    approximate_segment_length(&s, 32)?
                }
                "arc" => {
                    let center = point_field(&s, "center")?;
                    s["center"] = if s["center"].get("elementId").is_some() {
                        s["center"].clone()
                    } else {
                        point_value(center)
                    };
                    if field(&s, "radius")? <= EPS || field(&s, "sweepAngleDeg")?.abs() <= EPS {
                        return None;
                    }
                    let angle = field(&s, "startAngleDeg")?;
                    let end_angle = angle + field(&s, "sweepAngleDeg")?;
                    if !end_angle.is_finite() || end_angle == angle {
                        return None;
                    }
                    field(&s, "radius")? * field(&s, "sweepAngleDeg")?.to_radians().abs()
                }
                _ => return None,
            };
            if !length.is_finite() || length <= EPS {
                return None;
            }
            s["length"] = json!(length);
            Some(s)
        })
        .collect()
}

pub(crate) fn extract_path_interval(
    source: &Value,
    left: &ExtractBoundary,
    right: &ExtractBoundary,
    element_id: &str,
    name: &str,
) -> Result<ExtractInterval, ExtractError> {
    let invalid = || error("invalid-source");
    let segments = source_segments(source).ok_or_else(invalid)?;
    if segments.is_empty() {
        return Err(invalid());
    }
    for pair in segments.windows(2) {
        if distance(
            point_field(&pair[0], "end").ok_or_else(invalid)?,
            point_field(&pair[1], "start").ok_or_else(invalid)?,
        ) > TOLERANCE_MM
        {
            return Err(invalid());
        }
    }
    if source
        .get("closed")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || distance(
            point_field(&segments[0], "start").ok_or_else(invalid)?,
            point_field(segments.last().ok_or_else(invalid)?, "end").ok_or_else(invalid)?,
        ) <= EPS
        || segments.iter().any(|s| {
            s["kind"] == "arc" && field(s, "sweepAngleDeg").is_some_and(|n| n.abs() >= 360.0 - EPS)
        })
    {
        return Err(error("closed-source"));
    }
    let mut stations = vec![];
    for (boundary, bound) in [("left", left), ("right", right)] {
        match bound {
            ExtractBoundary::Start => stations.push(0.0),
            ExtractBoundary::End => stations.push(segments.len() as f64),
            ExtractBoundary::Point(p) => {
                let mut hits = vec![];
                for (i, s) in segments.iter().enumerate() {
                    hits.extend(
                        segment_stations(s, *p)
                            .ok_or_else(invalid)?
                            .iter()
                            .map(|t| i as f64 + t),
                    );
                }
                hits.sort_by(f64::total_cmp);
                hits.dedup_by(|a, b| (*a - *b).abs() <= EPS);
                if hits.len() != 1 {
                    return Err(ExtractError {
                        code: if hits.is_empty() {
                            "off-source"
                        } else {
                            "ambiguous-station"
                        },
                        boundary: Some(boundary),
                    });
                }
                stations.push(hits[0]);
            }
        }
    }
    let (a, b) = (stations[0], stations[1]);
    if (a - b).abs() <= EPS {
        return Err(error("zero-interval"));
    }
    let (lo, hi) = (a.min(b), a.max(b));
    let mut selected = vec![];
    for (i, s) in segments.iter().enumerate() {
        let from = (lo - i as f64).max(0.0);
        let to = (hi - i as f64).min(1.0);
        if to - from <= EPS {
            continue;
        }
        let mut cut = s.clone();
        if to < 1.0 {
            cut = split_offset_segment(&cut, to, point_at(s, to).ok_or_else(invalid)?)
                .ok_or_else(invalid)?
                .0;
        }
        if from > 0.0 {
            cut = split_offset_segment(&cut, from / to, point_at(s, from).ok_or_else(invalid)?)
                .ok_or_else(invalid)?
                .1;
        }
        selected.push(cut);
    }
    let length: f64 = selected.iter().filter_map(|s| field(s, "length")).sum();
    if length <= EPS {
        return Err(error("zero-interval"));
    }
    let (start, end, start_tangent, end_tangent) =
        offset_line_endpoint_measurements_from_values(&selected);
    let path_ids: Vec<Value> = source.get("elementId").cloned().into_iter().collect();
    let geometry = json!({ "kind": "joinedPath", "elementId": element_id, "name": name, "pathIds": path_ids, "closed": false, "segments": selected, "length": length, "start": start, "end": end, "startTangentAngleDeg": start_tangent, "endTangentAngleDeg": end_tangent });
    let station = |n: f64| {
        if n == segments.len() as f64 {
            (segments.len() - 1, 1.0)
        } else {
            (n.floor() as usize, n.fract())
        }
    };
    Ok(ExtractInterval {
        geometry: if a > b {
            reverse_line_like_geometry(&geometry).ok_or_else(invalid)?
        } else {
            geometry
        },
        left: station(a),
        right: station(b),
    })
}
