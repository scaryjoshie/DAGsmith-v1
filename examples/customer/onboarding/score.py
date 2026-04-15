"""Compute a risk score between 0.0 and 1.0 from enriched customer data.

Scoring is deliberately simple and readable — it's a demo, not real risk
modeling. Signals:
  - trusted email domains (.edu, .gov) lower the score
  - plus-addressed emails or many-dot local parts raise the score
  - teens score higher, seniors lower
  - missing phone raises the score
"""

from .types.records import EnrichedCustomer, ScoredCustomer


def process(customer: EnrichedCustomer) -> ScoredCustomer:
    score = 0.5  # neutral baseline

    local_part, _, domain = customer.email.partition("@")

    if domain.endswith((".edu", ".gov")):
        score -= 0.3
    if "+" in local_part:
        score += 0.15
    if local_part.count(".") >= 2:
        score += 0.1

    if customer.age_bracket == "teen":
        score += 0.2
    elif customer.age_bracket == "senior":
        score -= 0.1

    if customer.phone is None:
        score += 0.15

    score = max(0.0, min(1.0, round(score, 3)))

    return ScoredCustomer(
        name=customer.name,
        email=customer.email,
        age=customer.age,
        age_bracket=customer.age_bracket,
        initials=customer.initials,
        score=score,
        classification="pending",
    )
