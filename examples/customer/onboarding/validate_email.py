"""Check that a customer's email looks well-formed."""

import re

from dagsmith import emit

from .types.records import NormalizedCustomer, ValidationError

_EMAIL_RE = re.compile(r"^[\w.+-]+@[\w-]+\.[\w.-]+$")


def check(customer: NormalizedCustomer):
    if _EMAIL_RE.match(customer.email):
        return emit("valid", customer)
    return emit(
        "invalid",
        ValidationError(
            code="invalid_email",
            message=f"{customer.email!r} does not look like a valid email address",
            field="email",
        ),
    )
