"""Merge slice_info, model_settings and gcode headers into quote plates."""

from __future__ import annotations

import re
import zipfile

from plate_extractor.archive import (
    NotA3mfError,
    ReadBudget,
    open_archive,
    read_entry,
    read_entry_head,
)
from plate_extractor.gcode_header import GcodeHeader, parse_gcode_header
from plate_extractor.model_settings import PlateSlot, parse_model_settings
from plate_extractor.models import ExtractResult, Material, Plate
from plate_extractor.slice_info import SlicedPlate, parse_slice_info

_SLICE_INFO = "Metadata/slice_info.config"
_MODEL_SETTINGS = "Metadata/model_settings.config"
_DESCRIPTION_MAX = 120
# slice_info.config and model_settings.config are a few KB (about 1.7 KB per
# plate); the cap bounds the XML tree built from an untrusted upload.
_CONFIG_MAX_BYTES = 4_000_000
# Real plate thumbnails are about 7 KB. Each is base64-encoded into the response
# (and may be referenced by many plates), so thumbnails get their own limits.
_THUMBNAIL_MAX_BYTES = 512 * 1024
_THUMBNAIL_TOTAL_BYTES = 8 * 1024 * 1024
_GCODE_HEAD_BYTES = 512 * 1024
# Total decompressed bytes one request may read across all entries.
_REQUEST_BUDGET_BYTES = 64_000_000
_MAX_PLATES = 100
# Sanity range: a figure outside it is a corrupt or hostile file, not a quote.
_MAX_PRINT_TIME_S = 30 * 86400
_MAX_GRAMS = 10_000
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


def _read_thumbnail(
    zf: zipfile.ZipFile, path: str | None, budget: ReadBudget
) -> bytes | None:
    """Read a plate thumbnail named by the (uploader-controlled) model_settings.

    Only `Metadata/plate_N.png` entries are read, and only PNG bytes are
    returned, so a crafted `thumbnail_file` cannot exfiltrate other entries.
    """
    if not path or not _THUMBNAIL_PATH_RE.fullmatch(path):
        return None
    try:
        raw = read_entry(zf, path, _THUMBNAIL_MAX_BYTES, budget=budget)
    except NotA3mfError:  # oversize, corrupt or over budget: treated as absent
        return None
    if raw is None or not raw.startswith(_PNG_SIGNATURE):
        return None
    return raw


def _read_header(
    zf: zipfile.ZipFile, index: int, budget: ReadBudget
) -> GcodeHeader | None:
    """Parse the comment header from the head of the plate gcode only."""
    try:
        raw = read_entry_head(
            zf, f"Metadata/plate_{index}.gcode", _GCODE_HEAD_BYTES, budget=budget
        )
    except NotA3mfError:  # corrupt or over budget: treated as absent
        return None
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


def _implausible_reason(print_time_s: int, materials: tuple[Material, ...]) -> str | None:
    if print_time_s > _MAX_PRINT_TIME_S:
        return f"implausible print time ({print_time_s} s, over 30 days)"
    heaviest = max(m.grams for m in materials)
    if heaviest > _MAX_GRAMS:
        return f"implausible filament weight ({heaviest} g, over {_MAX_GRAMS} g)"
    return None


def _unique_plates(
    plates: tuple[SlicedPlate, ...], warnings: list[str]
) -> list[SlicedPlate]:
    """Keep the first listing of each plate index and at most _MAX_PLATES plates."""
    unique: dict[int, SlicedPlate] = {}
    duplicated: dict[int, None] = {}
    for plate in plates:
        if plate.index in unique:
            duplicated[plate.index] = None
        else:
            unique[plate.index] = plate
    kept = list(unique.values())[:_MAX_PLATES]
    kept_indices = {p.index for p in kept}
    for index in duplicated:
        if index in kept_indices:
            warnings.append(
                f"Plate {index} listed more than once in slice_info.config: "
                "only the first listing is used"
            )
    extra = len(unique) - len(kept)
    if extra > 0:
        warnings.append(
            f"{extra} more plates skipped: at most {_MAX_PLATES} plates are read"
        )
    return kept


def parse_plates(data: bytes, *, include_thumbnails: bool = True) -> ExtractResult:
    zf = open_archive(data)
    budget = ReadBudget(_REQUEST_BUDGET_BYTES)

    raw_info = read_entry(zf, _SLICE_INFO, _CONFIG_MAX_BYTES, budget=budget)
    if raw_info is None:
        raise NotSlicedError("no slice_info.config: the file was not sliced")
    raw_settings = read_entry(zf, _MODEL_SETTINGS, _CONFIG_MAX_BYTES, budget=budget)
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
    thumbnail_left = _THUMBNAIL_TOTAL_BYTES
    thumbnails_exhausted = False

    for sliced in _unique_plates(info.plates, warnings):
        slot = slot_by_index.get(sliced.index)
        if slot is not None and not slot.has_gcode:
            warnings.append(f"Plate {sliced.index} skipped: no gcode in the project")
            continue

        header = _read_header(zf, sliced.index, budget)
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
        implausible = _implausible_reason(print_time_s, materials)
        if implausible is not None:
            warnings.append(f"Plate {sliced.index} skipped: {implausible}")
            continue

        thumbnail = None
        if include_thumbnails and slot is not None and not thumbnails_exhausted:
            thumbnail = _read_thumbnail(zf, slot.thumbnail_path, budget)
            if thumbnail is not None:
                if len(thumbnail) > thumbnail_left:
                    thumbnail = None
                    thumbnails_exhausted = True
                    warnings.append(
                        f"Thumbnails from plate {sliced.index} on omitted: total "
                        f"thumbnail size limit of "
                        f"{_THUMBNAIL_TOTAL_BYTES // (1024 * 1024)} MiB reached"
                    )
                else:
                    thumbnail_left -= len(thumbnail)

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
