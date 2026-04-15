"""The `greet` node's selector: route a Reply to the formal or casual exit."""

from .types.records import Reply


def pick(reply: Reply) -> str:
    return "formal" if reply.formal else "casual"
