"""Pydantic types for the customer onboarding flow."""

from pydantic import BaseModel


class RawCustomer(BaseModel):
    name: str
    email: str
    phone: str | None = None
    age: int


class NormalizedCustomer(BaseModel):
    name: str
    email: str
    phone: str | None = None
    age: int


class EnrichedCustomer(BaseModel):
    name: str
    email: str
    phone: str | None = None
    age: int
    initials: str
    age_bracket: str  # "teen" | "adult" | "senior"


class ScoredCustomer(BaseModel):
    name: str
    email: str
    age: int
    age_bracket: str
    initials: str
    score: float
    classification: str


class ValidationError(BaseModel):
    code: str
    message: str
    field: str | None = None
