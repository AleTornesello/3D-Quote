"""Safe, read-only access to an untrusted .3mf (zip) upload held in memory."""

from __future__ import annotations

import io
import lzma
import struct
import zipfile
import zlib

# A Bambu Studio project has a few dozen entries; anything near these limits is
# hostile. Both are checked from the end record before zipfile builds one
# ZipInfo per entry, so a huge central directory is refused cheaply.
_MAX_ENTRIES = 10_000
_MAX_CENTRAL_DIR_BYTES = 4 * 1024 * 1024
DEFAULT_HEAD_BYTES = 512 * 1024
# 3MF (OPC) allows only stored and deflate. zipfile bounds deflate output per
# read; lzma and bzip2 are decompressed without an output limit, so a tiny
# entry could expand to gigabytes. They are refused.
_SUPPORTED_COMPRESSION = (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
_READ_ERRORS = (
    zipfile.BadZipFile,
    OSError,
    NotImplementedError,
    RuntimeError,
    EOFError,
    zlib.error,
    lzma.LZMAError,
)


class NotA3mfError(ValueError):
    """The upload is not a readable 3mf archive (or an entry is unsafe to read)."""


class ReadBudgetExceededError(NotA3mfError):
    """A read would exceed the per-request decompressed-bytes budget."""


class ReadBudget:
    """Total decompressed bytes all reads of one request may produce."""

    def __init__(self, total: int) -> None:
        self.remaining = max(0, total)

    def charge(self, n: int) -> None:
        self.remaining = max(0, self.remaining - n)


def _check_end_record(data: bytes) -> None:
    end_rec_data = getattr(zipfile, "_EndRecData", None)
    if end_rec_data is None:  # pragma: no cover - private stdlib helper
        return
    try:
        endrec = end_rec_data(io.BytesIO(data))
    except (OSError, ValueError, struct.error, zipfile.BadZipFile) as exc:
        raise NotA3mfError("not a zip archive") from exc
    if endrec is None:
        return  # not a zip: ZipFile reports it below
    entries = endrec[getattr(zipfile, "_ECD_ENTRIES_TOTAL", 4)]
    cd_size = endrec[getattr(zipfile, "_ECD_SIZE", 5)]
    if entries > _MAX_ENTRIES or cd_size > _MAX_CENTRAL_DIR_BYTES:
        raise NotA3mfError("too many zip entries")


def open_archive(data: bytes) -> zipfile.ZipFile:
    _check_end_record(data)
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, OSError, ValueError, EOFError, struct.error) as exc:
        raise NotA3mfError("not a zip archive") from exc
    if len(zf.filelist) > _MAX_ENTRIES:
        raise NotA3mfError("too many zip entries")
    return zf


def _is_safe_name(name: str) -> bool:
    if not name or name.startswith(("/", "\\")) or "\\" in name:
        return False
    return ".." not in name.split("/")


def _lookup(zf: zipfile.ZipFile, name: str) -> zipfile.ZipInfo | None:
    if not _is_safe_name(name):
        return None
    try:
        info = zf.getinfo(name)
    except KeyError:
        return None
    if info.compress_type not in _SUPPORTED_COMPRESSION:
        raise NotA3mfError(f"unsupported compression: {name}")
    return info


def _read(
    zf: zipfile.ZipFile, info: zipfile.ZipInfo, n: int, budget: ReadBudget | None
) -> bytes:
    """Read at most `n` decompressed bytes of `info`, charging `budget`."""
    try:
        with zf.open(info) as fh:
            content = fh.read(n)
    except _READ_ERRORS as exc:
        if budget is not None:
            # How much was decompressed before the error is unknown: assume all.
            budget.charge(n)
        raise NotA3mfError(f"unreadable entry: {info.filename}") from exc
    if budget is not None:
        budget.charge(len(content))
    return content


def read_entry(
    zf: zipfile.ZipFile,
    name: str,
    max_bytes: int = 20_000_000,
    *,
    budget: ReadBudget | None = None,
) -> bytes | None:
    """Return the bytes of the exact entry `name`, or None if absent/unsafe.

    Raises NotA3mfError when the entry is larger than `max_bytes`, unreadable
    or corrupt, and ReadBudgetExceededError (a NotA3mfError) when it does not
    fit in what is left of `budget`.
    """
    info = _lookup(zf, name)
    if info is None:
        return None
    if info.file_size > max_bytes:
        raise NotA3mfError(f"entry too large: {name}")
    if budget is not None and info.file_size > budget.remaining:
        raise ReadBudgetExceededError(f"read budget exceeded: {name}")
    allowed = max_bytes if budget is None else min(max_bytes, budget.remaining)
    # Bounded read: the declared size in the header can lie.
    content = _read(zf, info, allowed + 1, budget)
    if len(content) > max_bytes:
        raise NotA3mfError(f"entry too large: {name}")
    if len(content) > allowed:
        raise ReadBudgetExceededError(f"read budget exceeded: {name}")
    return content


def read_entry_head(
    zf: zipfile.ZipFile,
    name: str,
    max_bytes: int = DEFAULT_HEAD_BYTES,
    *,
    budget: ReadBudget | None = None,
) -> bytes | None:
    """Return at most the first `max_bytes` of entry `name`, or None if absent/unsafe.

    The entry may be of any size: only its head is decompressed. Raises
    NotA3mfError when the entry is unreadable or corrupt, and
    ReadBudgetExceededError when `budget` cannot cover the head.
    """
    info = _lookup(zf, name)
    if info is None:
        return None
    n = max_bytes
    if budget is not None:
        if min(max_bytes, info.file_size) > budget.remaining:
            raise ReadBudgetExceededError(f"read budget exceeded: {name}")
        n = min(max_bytes, budget.remaining)
    return _read(zf, info, n, budget)
