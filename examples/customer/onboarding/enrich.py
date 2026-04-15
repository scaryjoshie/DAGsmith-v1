"""Add derived fields — initials and age bracket — to a normalized customer."""

from .types.records import EnrichedCustomer, NormalizedCustomer


def process(customer: NormalizedCustomer) -> EnrichedCustomer:
    initials = "".join(part[0].upper() for part in customer.name.split() if part)
    if customer.age < 20:
        bracket = "teen"
    elif customer.age < 65:
        bracket = "adult"
    else:
        bracket = "senior"
    return EnrichedCustomer(
        name=customer.name,
        email=customer.email,
        phone=customer.phone,
        age=customer.age,
        initials=initials,
        age_bracket=bracket,
    )
