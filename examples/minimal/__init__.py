"""Minimal DAGsmith example workspace.

A single flow `hello` that routes `Greeting` to either a formal or
casual `Reply` public exit based on whether the input name is capitalized.
"""

from dagsmith import load_workspace

_workspace = load_workspace(__name__)

hello = _workspace.flow("hello")
