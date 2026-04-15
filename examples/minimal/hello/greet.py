"""The `greet` node: produce a personalized Reply for a Greeting."""

from .types.records import Greeting, Reply


def process(greeting: Greeting) -> Reply:
    formal = bool(greeting.name) and greeting.name[0].isupper()
    salutation = "Good day" if formal else "hi"
    return Reply(
        message=f"{salutation}, {greeting.name}",
        formal=formal,
    )
