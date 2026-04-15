"""Pydantic types for the `hello` flow."""

from pydantic import BaseModel


class Greeting(BaseModel):
    name: str


class Reply(BaseModel):
    message: str
    formal: bool
