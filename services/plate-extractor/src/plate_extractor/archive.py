"""Safe, read-only access to an untrusted .3mf (zip) upload held in memory."""

import io
import zipfile


class NotA3mfError(ValueError):
    """The upload is not a readable 3mf archive (or an entry is unsafe to read)."""


def open_archive(data: bytes) -> zipfile.ZipFile:
    try:
        return zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, OSError, ValueError) as exc:
        raise NotA3mfError("not a zip archive") from exc


def _is_safe_name(name: str) -> bool:
    if not name or name.startswith(("/", "\\")) or "\\" in name:
        return False
    return ".." not in name.split("/")


def read_entry(
    zf: zipfile.ZipFile, name: str, max_bytes: int = 20_000_000
) -> bytes | None:
    """Return the bytes of the exact entry `name`, or None if absent/unsafe.

    Raises NotA3mfError when the entry is larger than `max_bytes`.
    """
    if not _is_safe_name(name):
        return None
    try:
        info = zf.getinfo(name)
    except KeyError:
        return None
    if info.file_size > max_bytes:
        raise NotA3mfError(f"entry too large: {name}")
    try:
        with zf.open(info) as fh:
            # Bounded read: the declared size in the header can lie.
            content = fh.read(max_bytes + 1)
    except (zipfile.BadZipFile, OSError, NotImplementedError, RuntimeError) as exc:
        raise NotA3mfError(f"unreadable entry: {name}") from exc
    if len(content) > max_bytes:
        raise NotA3mfError(f"entry too large: {name}")
    return content
