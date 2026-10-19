"""HTTP API: upload a sliced .gcode.3mf, get its plates as JSON."""

from __future__ import annotations

import base64
import os
from dataclasses import asdict

from fastapi import FastAPI, Request, UploadFile
from fastapi.responses import JSONResponse

from plate_extractor.archive import NotA3mfError
from plate_extractor.extract import NotSlicedError, parse_plates
from plate_extractor.models import ExtractResult

_DEFAULT_MAX_UPLOAD_MB = 50
_CHUNK = 1024 * 1024
_MULTIPART_OVERHEAD = 64 * 1024


class FileTooLargeError(Exception):
    pass


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status, content={"error": {"code": code, "message": message}}
    )


def _read_capped(file: UploadFile, cap: int) -> bytes:
    """Read the upload in chunks, stopping as soon as it exceeds `cap` bytes."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = file.file.read(_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > cap:
            raise FileTooLargeError
        chunks.append(chunk)
    return b"".join(chunks)


def _thumbnail(raw: bytes | None) -> str | None:
    if raw is None:
        return None
    return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")


def _serialize(result: ExtractResult) -> dict:
    return {
        "source": {
            "slicer": result.slicer,
            "slicer_version": result.slicer_version,
            "printer_model": result.printer_model,
        },
        "plates": [
            {**asdict(p), "thumbnail": _thumbnail(p.thumbnail)} for p in result.plates
        ],
        "warnings": list(result.warnings),
    }


def create_app(max_upload_mb: int | None = None) -> FastAPI:
    if max_upload_mb is None:
        max_upload_mb = int(os.environ.get("MAX_UPLOAD_MB", _DEFAULT_MAX_UPLOAD_MB))
    cap = max_upload_mb * 1024 * 1024

    app = FastAPI(title="plate-extractor")

    @app.exception_handler(NotA3mfError)
    def _not_a_3mf(_: Request, exc: NotA3mfError) -> JSONResponse:
        return _error(400, "not_a_3mf", "The upload is not a valid .3mf archive.")

    @app.exception_handler(NotSlicedError)
    def _not_sliced(_: Request, exc: NotSlicedError) -> JSONResponse:
        return _error(422, "not_sliced", str(exc) or "No sliced plate found.")

    @app.exception_handler(FileTooLargeError)
    def _too_large(_: Request, exc: FileTooLargeError) -> JSONResponse:
        return _error(
            413, "file_too_large", f"The upload exceeds {max_upload_mb} MB."
        )

    @app.post("/plates")
    def plates(
        request: Request, file: UploadFile, include_thumbnails: bool = True
    ) -> dict:
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > cap + _MULTIPART_OVERHEAD:
            raise FileTooLargeError
        data = _read_capped(file, cap)
        return _serialize(parse_plates(data, include_thumbnails=include_thumbnails))

    @app.get("/healthz")
    def healthz() -> dict:
        return {"status": "ok"}

    return app


app = create_app()
