"""Parse Bambu Studio's Metadata/slice_info.config (untrusted XML)."""

from __future__ import annotations

from dataclasses import dataclass
from xml.etree.ElementTree import Element, ParseError

from defusedxml import DefusedXmlException
from defusedxml import ElementTree as SafeET


@dataclass(frozen=True)
class SlicedFilament:
    id: int
    type: str
    color: str | None
    used_g: float


@dataclass(frozen=True)
class SlicedPlate:
    index: int
    prediction_s: int | None
    weight_g: float | None
    support_used: bool
    objects: tuple[str, ...]
    filaments: tuple[SlicedFilament, ...]


@dataclass(frozen=True)
class SliceInfo:
    slicer: str | None
    slicer_version: str | None
    plates: tuple[SlicedPlate, ...]


def _float(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    return number if number == number and abs(number) != float("inf") else None


def _int(value: str | None) -> int | None:
    number = _float(value)
    return None if number is None else int(round(number))


def _parse_filament(el: Element) -> SlicedFilament | None:
    fid = _int(el.get("id"))
    if fid is None:
        return None
    used = _float(el.get("used_g"))
    return SlicedFilament(
        id=fid,
        type=el.get("type") or "",
        color=el.get("color") or None,
        used_g=used if used is not None else 0.0,
    )


def _parse_plate(el: Element, position: int) -> SlicedPlate:
    meta = {m.get("key"): m.get("value") for m in el.findall("metadata")}
    index = _int(meta.get("index"))
    objects = tuple(
        o.get("name") or ""
        for o in el.findall("object")
        if (o.get("skipped") or "").lower() != "true"
    )
    filaments = tuple(
        f for f in (_parse_filament(e) for e in el.findall("filament")) if f
    )
    return SlicedPlate(
        index=index if index is not None else position,
        prediction_s=_int(meta.get("prediction")),
        weight_g=_float(meta.get("weight")),
        support_used=(meta.get("support_used") or "").lower() == "true",
        objects=objects,
        filaments=filaments,
    )


def parse_slice_info(xml: bytes) -> SliceInfo:
    """Parse slice_info.config. Raises ValueError on malformed or hostile XML."""
    try:
        root = SafeET.fromstring(xml)
    except (DefusedXmlException, ParseError) as exc:
        raise ValueError(f"invalid slice_info.config: {exc}") from exc

    header = {
        h.get("key"): h.get("value")
        for h in root.findall("./header/header_item")
    }
    slicer = "BambuStudio" if "X-BBL-Client-Type" in header else None
    plates = tuple(
        _parse_plate(p, i) for i, p in enumerate(root.findall("plate"), start=1)
    )
    return SliceInfo(
        slicer=slicer,
        slicer_version=header.get("X-BBL-Client-Version"),
        plates=plates,
    )
