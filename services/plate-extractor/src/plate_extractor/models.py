from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Material:
    type: str
    color: str | None
    profile: str | None
    grams: float


@dataclass(frozen=True)
class Plate:
    index: int
    description: str
    print_time_s: int
    quantity: int
    support_used: bool
    materials: tuple[Material, ...]
    thumbnail: bytes | None


@dataclass(frozen=True)
class ExtractResult:
    slicer: str | None
    slicer_version: str | None
    printer_model: str | None
    plates: tuple[Plate, ...]
    warnings: tuple[str, ...]
