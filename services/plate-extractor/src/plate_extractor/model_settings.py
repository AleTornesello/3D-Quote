"""Parse Bambu Studio's Metadata/model_settings.config (untrusted XML)."""

from __future__ import annotations

from dataclasses import dataclass
from xml.etree.ElementTree import ParseError

from defusedxml import DefusedXmlException
from defusedxml import ElementTree as SafeET


@dataclass(frozen=True)
class PlateSlot:
    index: int
    name: str
    has_gcode: bool
    thumbnail_path: str | None


def parse_model_settings(xml: bytes) -> tuple[PlateSlot, ...]:
    """Parse model_settings.config. Raises ValueError on malformed or hostile XML."""
    try:
        root = SafeET.fromstring(xml)
    except (DefusedXmlException, ParseError) as exc:
        raise ValueError(f"invalid model_settings.config: {exc}") from exc

    slots: list[PlateSlot] = []
    for position, plate in enumerate(root.findall("plate"), start=1):
        meta = {m.get("key"): m.get("value") for m in plate.findall("metadata")}
        try:
            index = int(meta.get("plater_id") or position)
        except ValueError:
            index = position
        slots.append(
            PlateSlot(
                index=index,
                name=(meta.get("plater_name") or "").strip(),
                has_gcode=bool(meta.get("gcode_file")),
                thumbnail_path=meta.get("thumbnail_file") or None,
            )
        )
    return tuple(slots)
