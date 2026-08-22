pub(crate) fn degrees_to_radians(degrees: f64) -> f64 {
    degrees * (std::f64::consts::PI / 180.0)
}

pub(crate) fn radians_to_degrees(radians: f64) -> f64 {
    radians * (180.0 / std::f64::consts::PI)
}

pub(crate) fn normalize_degrees_360(degrees: f64) -> f64 {
    let remainder = degrees % 360.0;
    let normalized = if remainder < 0.0 {
        remainder + 360.0
    } else {
        remainder
    };
    if normalized == 0.0 {
        0.0
    } else {
        normalized
    }
}

pub(crate) fn atan2_degrees_360(y: f64, x: f64) -> f64 {
    if y == 0.0 && x == 0.0 {
        0.0
    } else {
        normalize_degrees_360(radians_to_degrees(y.atan2(x)))
    }
}

pub(crate) fn is_odd_multiple_of_90_degrees(degrees: f64) -> bool {
    (degrees % 180.0).abs() == 90.0
}
