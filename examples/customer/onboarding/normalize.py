"""Normalize raw customer input: trim whitespace, lowercase email."""

from .types.records import NormalizedCustomer, RawCustomer


def process(customer: RawCustomer) -> NormalizedCustomer:
    return NormalizedCustomer(
        name=customer.name.strip(),
        email=customer.email.strip().lower(),
        phone=customer.phone.strip() if customer.phone else None,
        age=customer.age,
    )
