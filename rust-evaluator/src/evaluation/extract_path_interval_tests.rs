use super::bezier_math::Point;
use super::extract_path_interval::{extract_path_interval, ExtractBoundary, ExtractInterval};
use serde_json::{json, Value};

fn p(x: f64, y: f64) -> Value {
    json!({"x": x, "y": y})
}
fn bound(x: f64, y: f64) -> ExtractBoundary {
    ExtractBoundary::Point(Point { x, y })
}
fn line() -> Value {
    json!({"kind":"line","start":p(0.0,0.0),"end":p(100.0,0.0),"length":100.0})
}
fn extract(s: &Value, a: ExtractBoundary, b: ExtractBoundary) -> ExtractInterval {
    extract_path_interval(s, &a, &b, "part", "part").unwrap()
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-9, "{a} != {b}");
}

#[test]
fn extract_line_and_reverse_analytic_oracle() {
    let source = line();
    let before = source.clone();
    for (a, b) in [(40.0, 70.0), (70.0, 40.0)] {
        let r = extract(&source, bound(a, 0.0), bound(b, 0.0));
        near(r.geometry["length"].as_f64().unwrap(), 30.0);
        near(r.geometry["start"]["x"].as_f64().unwrap(), a);
        near(r.geometry["end"]["x"].as_f64().unwrap(), b);
        near(
            r.geometry["startTangentAngleDeg"].as_f64().unwrap(),
            if a < b { 0.0 } else { 180.0 },
        );
    }
    assert_eq!(source, before);
}
#[test]
fn extract_arc_analytic_oracle() {
    let source = json!({"kind":"arcLine","center":p(0.0,0.0),"radius":100.0,"start":p(100.0,0.0),"end":p(-100.0,0.0),"startAngleDeg":0.0,"sweepAngleDeg":180.0,"length":100.0*std::f64::consts::PI});
    let polar = |d: f64| bound(100.0 * d.to_radians().cos(), 100.0 * d.to_radians().sin());
    for (a, b) in [(30.0, 120.0), (120.0, 30.0)] {
        let r = extract(&source, polar(a), polar(b));
        near(
            r.geometry["length"].as_f64().unwrap(),
            50.0 * std::f64::consts::PI,
        );
        near(
            r.geometry["segments"][0]["sweepAngleDeg"].as_f64().unwrap(),
            b - a,
        );
        near(
            r.geometry["segments"][0]["startAngleDeg"].as_f64().unwrap(),
            a,
        );
    }
}
#[test]
fn extract_subcubic_independent_de_casteljau_oracle() {
    let source = json!({"kind":"bezierCurve","segments":[{"start":p(0.0,0.0),"control1":p(0.0,40.0),"control2":p(100.0,40.0),"end":p(100.0,0.0)}]});
    for reverse in [false, true] {
        let (a, b) = if reverse {
            (84.375, 15.625)
        } else {
            (15.625, 84.375)
        };
        let r = extract(&source, bound(a, 22.5), bound(b, 22.5));
        let expected = if reverse {
            [
                (84.375, 22.5),
                (65.625, 32.5),
                (34.375, 32.5),
                (15.625, 22.5),
            ]
        } else {
            [
                (15.625, 22.5),
                (34.375, 32.5),
                (65.625, 32.5),
                (84.375, 22.5),
            ]
        };
        for (key, (x, y)) in ["start", "control1", "control2", "end"]
            .iter()
            .zip(expected)
        {
            near(r.geometry["segments"][0][key]["x"].as_f64().unwrap(), x);
            near(r.geometry["segments"][0][key]["y"].as_f64().unwrap(), y);
        }
        assert_eq!(r.left, (0, if reverse { 0.75 } else { 0.25 }));
        assert_eq!(r.right, (0, if reverse { 0.25 } else { 0.75 }));
    }
}
#[test]
fn extract_divisions_overlap_and_distinct_equal_intervals() {
    let source = line();
    for (a, b, length) in [
        (0.0, 40.0, 40.0),
        (40.0, 70.0, 30.0),
        (70.0, 100.0, 30.0),
        (0.0, 70.0, 70.0),
        (40.0, 100.0, 60.0),
    ] {
        near(
            extract(&source, bound(a, 0.0), bound(b, 0.0)).geometry["length"]
                .as_f64()
                .unwrap(),
            length,
        );
    }
    let first = extract(&source, bound(40.0, 0.0), bound(70.0, 0.0));
    let second = extract_path_interval(
        &source,
        &bound(40.0, 0.0),
        &bound(70.0, 0.0),
        "other",
        "other",
    )
    .unwrap();
    assert_ne!(first.geometry["elementId"], second.geometry["elementId"]);
}
#[test]
fn extract_joined_offset_polyline_and_recomputation() {
    for kind in ["polyline", "offsetLine", "joinedPath"] {
        let mut source = json!({"kind":kind,"closed":false,"segments":[
            {"kind":"line","start":p(0.0,0.0),"end":p(100.0,0.0),"length":100.0},
            {"kind":"line","start":p(100.0,0.0),"end":p(100.0,100.0),"length":100.0}]});
        let r = extract(&source, bound(40.0, 0.0), bound(100.0, 70.0));
        near(r.geometry["length"].as_f64().unwrap(), 130.0);
        assert_eq!(r.geometry["segments"].as_array().unwrap().len(), 2);
        assert_eq!(
            extract(&source, bound(100.0, 0.0), ExtractBoundary::End).left,
            (1, 0.0)
        );
        source["segments"][0]["start"]["y"] = json!(10.0);
        source["segments"][0]["end"]["y"] = json!(10.0);
        source["segments"][1]["start"]["y"] = json!(10.0);
        assert_eq!(
            extract_path_interval(&source, &bound(40.0, 0.0), &ExtractBoundary::End, "p", "p")
                .unwrap_err()
                .code,
            "off-source"
        );
        near(
            extract(&source, bound(40.0, 10.0), bound(100.0, 70.0)).geometry["length"]
                .as_f64()
                .unwrap(),
            120.0,
        );
    }
}
#[test]
fn extract_ambiguous_crossings_and_retraced_cubic_fail_closed() {
    let crossing = json!({"kind":"joinedPath","segments":[
        {"kind":"line","start":p(0.0,0.0),"end":p(100.0,100.0)},
        {"kind":"line","start":p(100.0,100.0),"end":p(0.0,100.0)},
        {"kind":"line","start":p(0.0,100.0),"end":p(100.0,0.0)}]});
    let e = extract_path_interval(
        &crossing,
        &ExtractBoundary::Start,
        &bound(50.0, 50.0),
        "p",
        "p",
    )
    .unwrap_err();
    assert_eq!(e.code, "ambiguous-station");
    assert_eq!(e.boundary, Some("right"));
    let retraced = json!({"kind":"bezierCurve","segments":[{"start":p(0.0,0.0),"control1":p(200.0,0.0),"control2":p(-100.0,0.0),"end":p(100.0,0.0)}]});
    assert_eq!(
        extract_path_interval(
            &retraced,
            &bound(50.0, 0.0),
            &ExtractBoundary::End,
            "p",
            "p"
        )
        .unwrap_err()
        .code,
        "ambiguous-station"
    );
}
#[test]
fn extract_invalid_source_and_boundary_cases() {
    let source = line();
    assert_eq!(
        extract_path_interval(&source, &bound(40.0, 0.0), &bound(40.0, 0.0), "p", "p")
            .unwrap_err()
            .code,
        "zero-interval"
    );
    assert_eq!(
        extract_path_interval(&source, &bound(40.0, 2.0), &ExtractBoundary::End, "p", "p")
            .unwrap_err()
            .code,
        "off-source"
    );
    for invalid in [
        json!({"kind":"point","x":0,"y":0}),
        json!({"kind":"image"}),
        json!({"kind":"text"}),
        json!({"kind":"joinedPath","segments":[]}),
    ] {
        assert_eq!(
            extract_path_interval(
                &invalid,
                &ExtractBoundary::Start,
                &ExtractBoundary::End,
                "p",
                "p"
            )
            .unwrap_err()
            .code,
            "invalid-source"
        );
    }
    let closed = json!({"kind":"polyline","closed":true,"segments":[{"kind":"line","start":p(0.0,0.0),"end":p(1.0,0.0)}]});
    assert_eq!(
        extract_path_interval(
            &closed,
            &ExtractBoundary::Start,
            &ExtractBoundary::End,
            "p",
            "p"
        )
        .unwrap_err()
        .code,
        "closed-source"
    );
}

#[test]
fn extract_mixed_segments_reversed_source_and_captured_provenance() {
    use super::path_reverse_geometry::reverse_line_like_geometry;
    let source = json!({"kind":"offsetLine","closed":false,"segments":[
        {"kind":"bezier","start":p(0.0,0.0),"control1":p(0.0,40.0),"control2":p(100.0,40.0),"end":p(100.0,0.0)},
        {"kind":"arc","center":p(150.0,0.0),"radius":50.0,"start":p(100.0,0.0),"end":p(200.0,0.0),"startAngleDeg":180.0,"sweepAngleDeg":180.0}]});
    let r = extract(&source, bound(15.625, 22.5), bound(150.0, -50.0));
    assert_eq!(r.left, (0, 0.25));
    assert_eq!(r.right, (1, 0.5));
    assert_eq!(r.geometry["segments"][0]["kind"], "bezier");
    assert_eq!(r.geometry["segments"][1]["kind"], "arc");
    near(
        r.geometry["segments"][1]["sweepAngleDeg"].as_f64().unwrap(),
        90.0,
    );
    let whole = extract(&source, ExtractBoundary::Start, ExtractBoundary::End);
    let reversed = reverse_line_like_geometry(&whole.geometry).unwrap();
    let backward = extract(&reversed, bound(150.0, -50.0), bound(15.625, 22.5));
    assert_eq!(backward.left, (0, 0.5));
    assert_eq!(backward.right, (1, 0.75));
    near(
        r.geometry["length"].as_f64().unwrap(),
        backward.geometry["length"].as_f64().unwrap(),
    );
}

#[test]
fn extract_subcubic_after_rotation_reflection_translation() {
    let source = json!({"kind":"bezierCurve","segments":[{"start":p(70.0,30.0),"control1":p(30.0,30.0),"control2":p(30.0,-70.0),"end":p(70.0,-70.0)}]});
    let r = extract(&source, bound(47.5, 14.375), bound(47.5, -54.375));
    let shape = [
        (47.5, 14.375),
        (37.5, -4.375),
        (37.5, -35.625),
        (47.5, -54.375),
    ];
    for (key, (x, y)) in ["start", "control1", "control2", "end"].iter().zip(shape) {
        near(r.geometry["segments"][0][key]["x"].as_f64().unwrap(), x);
        near(r.geometry["segments"][0][key]["y"].as_f64().unwrap(), y);
    }
}

#[test]
fn extract_rejects_disconnected_and_unstable_sources_and_accepts_value_polylines() {
    let disconnected = json!({"kind":"joinedPath","segments":[
        {"kind":"line","start":p(0.0,0.0),"end":p(100.0,0.0)},
        {"kind":"line","start":p(200.0,0.0),"end":p(300.0,0.0)}]});
    let unstable = json!({"kind":"arcLine","center":p(0.0,0.0),"radius":100.0,"start":p(100.0,0.0),"end":p(-100.0,0.0),"startAngleDeg":1e300,"sweepAngleDeg":180.0});
    for s in [disconnected, unstable] {
        assert_eq!(
            extract_path_interval(&s, &ExtractBoundary::Start, &ExtractBoundary::End, "p", "p")
                .unwrap_err()
                .code,
            "invalid-source"
        );
    }
    let source = json!({"kind":"polyline","closed":false,"segments":[{"start":p(0.0,0.0),"end":p(100.0,0.0),"length":100.0}]});
    near(
        extract(&source, bound(40.0, 0.0), bound(70.0, 0.0)).geometry["length"]
            .as_f64()
            .unwrap(),
        30.0,
    );
}
