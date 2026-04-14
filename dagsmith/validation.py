"""Validation helpers for the core DAGsmith model."""

from __future__ import annotations

from graphlib import CycleError, TopologicalSorter
from typing import List

from .model import FlowSpec, TypeRef


class FlowValidationError(ValueError):
    """Raised when a flow graph is invalid."""


def are_types_compatible(source: TypeRef, target: TypeRef) -> bool:
    """Small placeholder until real type resolution lands."""

    return source == target or "Any" in (source, target)


def validate_flow(flow: FlowSpec) -> FlowSpec:
    """Validate graph structure and basic exit/input compatibility."""

    errors: List[str] = []
    if flow.entry_node not in flow.nodes:
        errors.append("entry node %r does not exist" % flow.entry_node)

    for edge in flow.edges:
        source = flow.nodes.get(edge.from_node)
        if source is None:
            errors.append("unknown source node %r" % edge.from_node)
            continue
        if edge.from_exit not in source.exits:
            errors.append("unknown exit %r on node %r" % (edge.from_exit, edge.from_node))
            continue

        payload_type = source.exits[edge.from_exit].type_ref
        if edge.to_node is not None:
            target = flow.nodes.get(edge.to_node)
            if target is None:
                errors.append("unknown target node %r" % edge.to_node)
            elif not are_types_compatible(payload_type, target.input_type):
                errors.append(
                    "type mismatch from %s.%s (%s) to %s (%s)"
                    % (edge.from_node, edge.from_exit, payload_type, edge.to_node, target.input_type)
                )
            continue

        target_exit = flow.public_exits.get(edge.to_flow_exit or "")
        if target_exit is None:
            errors.append("unknown flow exit %r" % edge.to_flow_exit)
        elif not are_types_compatible(payload_type, target_exit.type_ref):
            errors.append(
                "type mismatch from %s.%s (%s) to flow exit %s (%s)"
                % (
                    edge.from_node,
                    edge.from_exit,
                    payload_type,
                    edge.to_flow_exit,
                    target_exit.type_ref,
                )
            )

    if _has_cycle(flow):
        errors.append("flow contains a cycle")

    if errors:
        raise FlowValidationError("\n".join(errors))
    return flow


def _has_cycle(flow: FlowSpec) -> bool:
    graph = TopologicalSorter()
    for node_name in flow.nodes:
        graph.add(node_name, *(edge.from_node for edge in flow.incoming(node_name)))
    try:
        tuple(graph.static_order())
    except CycleError:
        return True
    return False
