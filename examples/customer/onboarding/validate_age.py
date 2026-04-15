"""Check that a customer is at least 13 years old."""

from dagsmith import emit

from .types.records import NormalizedCustomer, ValidationError

_MINIMUM_AGE = 13


def check(customer: NormalizedCustomer):
    if customer.age < _MINIMUM_AGE:
        return emit(
            "invalid",
            ValidationError(
                code="underage",
                message=(
                    f"age {customer.age} is below the minimum of {_MINIMUM_AGE}"
                ),
                field="age",
            ),
        )
    return emit("valid", customer)
