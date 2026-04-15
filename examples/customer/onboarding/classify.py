"""Classify a scored customer as low, medium, or high risk and emit."""

from dagsmith import emit

from .types.records import ScoredCustomer


def classify(customer: ScoredCustomer):
    if customer.score >= 0.65:
        label = "high_risk"
    elif customer.score >= 0.35:
        label = "medium_risk"
    else:
        label = "low_risk"
    classified = customer.model_copy(update={"classification": label})
    return emit(label, classified)
