"""Diagnostic model for DAGsmith's permissive-save / strict-run posture.

Violations render as diagnostics on the workspace, not exceptions at load time.
`Diagnostic.id` auto-computes from (flow_id, code, locus, message hash) so
`derived_from` edges can point at root causes without manual id wrangling.
`UnresolvableRef` is a sentinel stored in the callable table when a ref can't
be resolved; calling it raises, matching Python's "broken import" experience.
"""
from __future__ import annotations

import hashlib
from typing import Any, Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, computed_field

DiagnosticCode = Literal[
    "unresolved_ref",
    "cycle",
    "cross_flow_cycle",
    "type_mismatch",
    "ambiguous_route",
    "multiple_public_exits_reached",
    "syntax_error",
    "missing_entry_node",
    "no_public_exits",
    "merged_exit_type_mismatch",
    "unresolved_flow_ref",
    "subflow_exit_mismatch",
    "unused_exit",
    "dangling_edge_target",
    "unknown_edge_exit",
    "malformed_flow_json",
    "invalid_flow_spec",
]

Severity = Literal["error", "warning", "info"]


class _Base(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore")


class SourceLocation(_Base):
    path: str = ""
    line: int = 0
    col: int = 0


def _short_hash(message: str) -> str:
    return hashlib.sha1(message.encode("utf-8")).hexdigest()[:8]


def _build_id(
    flow_id: str,
    code: DiagnosticCode,
    node_id: str | None,
    edge_index: int | None,
    message: str,
) -> str:
    locus = node_id if node_id is not None else (
        str(edge_index) if edge_index is not None else "flow"
    )
    return f"{flow_id}:{code}:{locus}:{_short_hash(message)}"


class Diagnostic(_Base):
    severity: Severity
    code: DiagnosticCode
    message: str
    flow_id: str
    node_id: str | None = None
    edge_index: int | None = None
    source_location: SourceLocation | None = None
    detail: Mapping[str, Any] = Field(default_factory=dict)
    derived_from: str | None = None

    @computed_field
    @property
    def id(self) -> str:
        return _build_id(
            self.flow_id, self.code, self.node_id, self.edge_index, self.message
        )


class UnresolvableRef:
    __slots__ = ("diagnostic",)

    def __init__(self, diagnostic: Diagnostic) -> None:
        self.diagnostic = diagnostic

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        raise RuntimeError(
            f"Ref is unresolvable ({self.diagnostic.id}): {self.diagnostic.message}"
        )

    def __repr__(self) -> str:
        return f"UnresolvableRef({self.diagnostic.id})"
