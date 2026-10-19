"""Merge slice_info, model_settings and gcode headers into quote plates."""

from __future__ import annotations

import re
import zipfile

from plate_extractor.archive import NotA3mfError, open_archive, read_entry
from plate_extractor.gcode_header import GcodeHeader, parse_gcode_header
from plate_extractor.model_settings import PlateSlot, parse_model_settings
from plate_extractor.models import ExtractResult, Material, Plate
from plate_extractor.slice_info import SlicedPlate, parse_slice_info

_SLICE_INFO = "Metadata/slice_info.config"
_MODEL_SETTINGS = "Metadata/model_settings.config"
_DESCRIPTION_MAX = 120
_ENTRY_MAX_BYTES = 20_000_000
_THUMBNAIL_PATH_RE = re.compile(r"Metadata/plate_[0-9]+\.png")
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class NotSlicedError(ValueError):
    """The archive holds no sliced plate that can be turned into a quote plate."""


def describe_plate(slot_name: str, objects: tuple[str, ...], index: int) -> str:
    name = slot_name.strip()
    if name:
        return name
    unique = list(dict.fromkeys(o.strip() for o in objects if o.strip()))
    if not unique:
        return f"Plate {index}"
    text = ", ".join(unique)
    if len(text) > _DESCRIPTION_MAX:
        text = text[: _DESCRIPTION_MAX - 1] + "…"
    return text


def _read_optional(zf: zipfile.ZipFile, name: str) -> bytes | None:
    """Read an optional entry; an oversize/unreadable one counts as absent."""
    try:
        return read_entry(zf, name, _ENTRY_MAX_BYTES)
    except NotA3mfError:
        return None


def _read_thumbnail(zf: zipfile.ZipFile, path: str | None) -> bytes | None:
    """Read a plate thumbnail named by the (uploader-controlled) model_settings.

    Only `Metadata/plate_N.png` entries are read, and only PNG bytes are
    returned, so a crafted `thumbnail_file` cannot exfiltrate other entries.
    """
    if not path or not _THUMBNAIL_PATH_RE.fullmatch(path):
        return None
    raw = _read_optional(zf, path)
    if raw is None or not raw.startswith(_PNG_SIGNATURE):
        return None
    return raw


def _read_header(zf: zipfile.ZipFile, index: int) -> GcodeHeader | None:
    raw = _read_optional(zf, f"Metadata/plate_{index}.gcode")
    if raw is None:
        return None
    return parse_gcode_header(raw.decode("utf-8", "replace"))


def _print_time(plate: SlicedPlate, header: GcodeHeader | None) -> int | None:
    if plate.prediction_s is not None and plate.prediction_s > 0:
        return plate.prediction_s
    if (
        header is not None
        and header.total_time_s is not None
        and header.total_time_s > 0
    ):
        return header.total_time_s
    return None


def _materials(plate: SlicedPlate, header: GcodeHeader | None) -> tuple[Material, ...]:
    profiles = header.profiles if header is not None else ()
    rows: list[Material] = []
    for filament in plate.filaments:
        grams = round(filament.used_g, 2)
        if grams <= 0:
            continue
        position = filament.id - 1
        profile = profiles[position] if 0 <= position < len(profiles) else None
        rows.append(
            Material(
                type=filament.type,
                color=filament.color,
                profile=profile or None,
                grams=grams,
            )
        )
    return tuple(rows)


def _no_material_reason(plate: SlicedPlate, header: GcodeHeader | None) -> str:
    if plate.filaments:
        return "no filament with a positive weight"
    weight = header.weight_g if header is not None else None
    if weight is not None and weight > 0:
        return f"no filament rows ({round(weight, 2)} g in gcode header, material type unknown)"
    return "no filament rows"


def parse_plates(data: bytes, *, include_thumbnails: bool = True) -> ExtractResult:
    zf = open_archive(data)

    raw_info = read_entry(zf, _SLICE_INFO)
    if raw_info is None:
        raise NotSlicedError("no slice_info.config: the file was not sliced")
    raw_settings = read_entry(zf, _MODEL_SETTINGS)
    # Malformed or hostile XML means an unreadable 3mf, not a server error.
    try:
        info = parse_slice_info(raw_info)
        slots = parse_model_settings(raw_settings) if raw_settings is not None else ()
    except ValueError as exc:
        raise NotA3mfError(str(exc)) from exc
    slot_by_index: dict[int, PlateSlot] = {}
    for slot in slots:
        slot_by_index.setdefault(slot.index, slot)

    plates: list[Plate] = []
    warnings: list[str] = []
    printer_model: str | None = None

    for sliced in info.plates:
        slot = slot_by_index.get(sliced.index)
        if slot is not None and not slot.has_gcode:
            warnings.append(f"Plate {sliced.index} skipped: no gcode in the project")
            continue

        header = _read_header(zf, sliced.index)
        if printer_model is None and header is not None:
            printer_model = header.printer_model

        print_time_s = _print_time(sliced, header)
        if print_time_s is None:
            warnings.append(f"Plate {sliced.index} skipped: no print time")
            continue
        materials = _materials(sliced, header)
        if not materials:
            reason = _no_material_reason(sliced, header)
            warnings.append(f"Plate {sliced.index} skipped: {reason}")
            continue

        thumbnail = None
        if include_thumbnails and slot is not None:
            thumbnail = _read_thumbnail(zf, slot.thumbnail_path)

        plates.append(
            Plate(
                index=sliced.index,
                description=describe_plate(
                    slot.name if slot is not None else "", sliced.objects, sliced.index
                ),
                print_time_s=print_time_s,
                quantity=1,
                support_used=sliced.support_used,
                materials=materials,
                thumbnail=thumbnail,
            )
        )

    if not plates:
        detail = "; ".join(warnings) if warnings else "slice_info.config lists no plate"
        raise NotSlicedError(f"no sliced plate found ({detail})")

    return ExtractResult(
        slicer=info.slicer,
        slicer_version=info.slicer_version,
        printer_model=printer_model,
        plates=tuple(plates),
        warnings=tuple(warnings),
    )
