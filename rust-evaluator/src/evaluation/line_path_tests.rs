use super::line_path::point_at_distance_from_endpoint;
use serde_json::{json, Value};

fn arc_line(start_angle_deg: f64, sweep_angle_deg: f64, radius: f64) -> Value {
    let point_at = |angle_deg: f64| {
        let angle = angle_deg.to_radians();
        json!({ "x": radius * angle.cos(), "y": radius * angle.sin() })
    };
    json!({
        "kind": "arcLine",
        "center": { "x": 0.0, "y": 0.0 },
        "start": point_at(start_angle_deg),
        "end": point_at(start_angle_deg + sweep_angle_deg),
        "radius": radius,
        "startAngleDeg": start_angle_deg,
        "sweepAngleDeg": sweep_angle_deg,
        "length": radius * sweep_angle_deg.to_radians().abs()
    })
}

fn assert_point(actual: Option<(f64, f64)>, expected: (f64, f64)) {
    let (x, y) = actual.expect("expected a traversed point");
    assert!(
        (x - expected.0).abs() < 1e-9,
        "x was {x}, expected {}",
        expected.0
    );
    assert!(
        (y - expected.1).abs() < 1e-9,
        "y was {y}, expected {}",
        expected.1
    );
}

fn circle_point(radius: f64, angle_deg: f64) -> (f64, f64) {
    let angle = angle_deg.to_radians();
    (radius * angle.cos(), radius * angle.sin())
}

#[test]
fn concrete_quarter_arc_uses_physical_length_and_reverses_analytically() {
    let arc = arc_line(0.0, 90.0, 10.0);
    let full_length = arc["length"].as_f64().unwrap();
    let start = circle_point(10.0, 0.0);
    let end = circle_point(10.0, 90.0);

    assert_point(point_at_distance_from_endpoint(&arc, "start", 0.0), start);
    assert_point(
        point_at_distance_from_endpoint(&arc, "start", full_length),
        end,
    );
    assert_point(
        point_at_distance_from_endpoint(&arc, "end", full_length),
        start,
    );

    let forward_quarter = point_at_distance_from_endpoint(&arc, "start", full_length / 4.0);
    let reverse_three_quarters =
        point_at_distance_from_endpoint(&arc, "end", full_length * 3.0 / 4.0);
    assert_point(forward_quarter, circle_point(10.0, 22.5));
    assert_point(reverse_three_quarters, circle_point(10.0, 22.5));
}

#[test]
fn clockwise_non_quarter_arc_uses_sweep_fraction_from_both_endpoints() {
    let arc = arc_line(25.0, -130.0, 7.0);
    let full_length = arc["length"].as_f64().unwrap();

    assert_point(
        point_at_distance_from_endpoint(&arc, "start", full_length / 2.0),
        circle_point(7.0, -40.0),
    );
    assert_point(
        point_at_distance_from_endpoint(&arc, "end", full_length / 2.0),
        circle_point(7.0, -40.0),
    );
    assert_point(
        point_at_distance_from_endpoint(&arc, "start", full_length),
        circle_point(7.0, -105.0),
    );
    assert_point(
        point_at_distance_from_endpoint(&arc, "end", full_length),
        circle_point(7.0, 25.0),
    );
}

#[test]
fn joined_and_offset_paths_carry_the_full_arc_length_into_later_lines() {
    let arc_length = 10.0 * 90.0_f64.to_radians();
    let arc = json!({
        "kind": "arc",
        "center": { "x": 0.0, "y": 0.0 },
        "start": { "x": 10.0, "y": 0.0 },
        "end": { "x": 0.0, "y": 10.0 },
        "radius": 10.0,
        "startAngleDeg": 0.0,
        "sweepAngleDeg": 90.0,
        "length": arc_length
    });
    let before = json!({
        "kind": "line", "start": { "x": 0.0, "y": 0.0 },
        "end": { "x": 10.0, "y": 0.0 }, "length": 10.0
    });
    let after = json!({
        "kind": "line", "start": { "x": 0.0, "y": 10.0 },
        "end": { "x": 0.0, "y": 30.0 }, "length": 20.0
    });
    let joined = json!({
        "kind": "joinedPath",
        "start": { "x": 0.0, "y": 0.0 },
        "end": { "x": 0.0, "y": 30.0 },
        "segments": [before, arc.clone(), after.clone()],
        "length": 30.0 + arc_length
    });
    let offset = json!({
        "kind": "offsetLine",
        "start": { "x": 10.0, "y": 0.0 },
        "end": { "x": 0.0, "y": 20.0 },
        "segments": [arc, after],
        "length": 20.0 + arc_length
    });

    assert_point(
        point_at_distance_from_endpoint(&joined, "start", 10.0 + arc_length * 0.4),
        circle_point(10.0, 36.0),
    );
    assert_point(
        point_at_distance_from_endpoint(&joined, "start", 10.0 + arc_length + 5.0),
        (0.0, 15.0),
    );
    assert_point(
        point_at_distance_from_endpoint(&joined, "end", 20.0 + arc_length / 2.0),
        circle_point(10.0, 45.0),
    );
    assert_point(
        point_at_distance_from_endpoint(&offset, "start", arc_length + 2.0),
        (0.0, 12.0),
    );
}
