"""Customer workspace — a more realistic DAGsmith example.

Exposes a single flow, `onboarding`, which takes a RawCustomer and
routes it through normalization, two validation steps, enrichment,
scoring, and classification into one of four public exits:
`invalid`, `high_risk`, `medium_risk`, or `low_risk`.
"""

from dagsmith import load_workspace

_workspace = load_workspace(__name__)

onboarding = _workspace.flow("onboarding")
