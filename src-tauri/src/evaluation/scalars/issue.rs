//! Stable, deterministic issue codes for the scalar payload validation
//! boundary. This is a new convention for this codebase (no prior Rust
//! module here has a stable string error-code field - `errors.rs` only
//! builds human-readable Japanese message structs); it deliberately mirrors
//! how TS's `ScalarEvaluation.issueCode` is a stable string, but lives in
//! its own `scalar-payload-*` namespace, distinct from both that open TS
//! evaluation-issue vocabulary and the DSL diagnostic catalog in
//! docs/typed-variables/plan.md - neither of those is reused at this
//! boundary layer.

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScalarPayloadIssueCode {
    NotAnObject,
    UnknownKind,
    MissingField,
    UnexpectedField,
    InvalidFieldType,
    InvalidChoiceOptions,
    InvalidChoiceMember,
    LiteralTypeMismatch,
    InvalidBindingId,
    InconsistentReferenceBinding,
    InvalidOperator,
    InvalidSpan,
    DepthExceeded,
    NodeCountExceeded,
    ChoiceOptionsLimitExceeded,
    InvalidEvaluationStatus,
    InvalidEvaluationValue,
    InvalidIssueCode,
    InvalidVersionId,
    InconsistentVersionPredecessor,
    InvalidSourceOrder,
    InvalidControlOwner,
    InvalidElementSourceOrder,
}

impl ScalarPayloadIssueCode {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::NotAnObject => "scalar-payload-not-an-object",
            Self::UnknownKind => "scalar-payload-unknown-kind",
            Self::MissingField => "scalar-payload-missing-field",
            Self::UnexpectedField => "scalar-payload-unexpected-field",
            Self::InvalidFieldType => "scalar-payload-invalid-field-type",
            Self::InvalidChoiceOptions => "scalar-payload-invalid-choice-options",
            Self::InvalidChoiceMember => "scalar-payload-invalid-choice-member",
            Self::LiteralTypeMismatch => "scalar-payload-literal-type-mismatch",
            Self::InvalidBindingId => "scalar-payload-invalid-binding-id",
            Self::InconsistentReferenceBinding => "scalar-payload-inconsistent-reference-binding",
            Self::InvalidOperator => "scalar-payload-invalid-operator",
            Self::InvalidSpan => "scalar-payload-invalid-span",
            Self::DepthExceeded => "scalar-payload-depth-exceeded",
            Self::NodeCountExceeded => "scalar-payload-node-count-exceeded",
            Self::ChoiceOptionsLimitExceeded => "scalar-payload-choice-options-limit-exceeded",
            Self::InvalidEvaluationStatus => "scalar-payload-invalid-evaluation-status",
            Self::InvalidEvaluationValue => "scalar-payload-invalid-evaluation-value",
            Self::InvalidIssueCode => "scalar-payload-invalid-issue-code",
            Self::InvalidVersionId => "scalar-payload-invalid-version-id",
            Self::InconsistentVersionPredecessor => {
                "scalar-payload-inconsistent-version-predecessor"
            }
            Self::InvalidSourceOrder => "scalar-payload-invalid-source-order",
            Self::InvalidControlOwner => "scalar-payload-invalid-control-owner",
            Self::InvalidElementSourceOrder => "scalar-payload-invalid-element-source-order",
        }
    }
}

impl fmt::Display for ScalarPayloadIssueCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ScalarPayloadIssue {
    pub(crate) code: ScalarPayloadIssueCode,
    pub(crate) message: String,
}

impl ScalarPayloadIssue {
    pub(crate) fn new(code: ScalarPayloadIssueCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
