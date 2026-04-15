"""DAGsmith: visual flowchart-based Python authoring tool.

Public API:

- `load_workspace(package_name)`: load a DAGsmith workspace from a package.
- `Workspace.flow(flow_id)`: get a callable for a named flow.
- `FlowResult`: what calling a flow returns (`.exit` and `.value`).
- `emit(exit_name, value)`: explicit routing from inside a node.
- `WorkspaceError`: raised on load or validation failures.
"""

from .runtime import FlowResult, emit
from .workspace import Workspace, WorkspaceError, load_workspace

__all__ = [
    "FlowResult",
    "Workspace",
    "WorkspaceError",
    "emit",
    "load_workspace",
]
