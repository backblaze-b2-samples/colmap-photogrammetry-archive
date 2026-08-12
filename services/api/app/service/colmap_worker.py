"""Run the COLMAP engine in an isolated 'spawn' worker process.

A native abort/segfault inside COLMAP's C++ kernels CANNOT be caught by an
in-process ``try/except`` and CANNOT be reclaimed by a thread-level timeout — it
kills/zombifies the worker. In the single-worker API that would (a) strand the
project "running" forever and (b) take the whole API down with it. Running the
reconstruction in a separate process contains both failure modes: a native crash
kills only the child, and a genuine hang is bounded by killing the child on
timeout.

Only picklable data crosses the process boundary: the ``images``
(``list[(name, bytes)]``) go in and a ``ColmapResult`` (bytes + plain fields)
comes back. B2 I/O stays in the PARENT (``service/reconstruction_runner.py``), so
the child imports no ``boto3`` — it only runs COLMAP.
"""

import logging
import multiprocessing as mp
import time
from collections.abc import Callable
from typing import Any

from app.repo.colmap_engine import ColmapResult, run_reconstruction

logger = logging.getLogger(__name__)

# Grace period to reap a child after it has produced a result / been killed.
_JOIN_GRACE_SECONDS = 5.0


class ReconstructionTimeout(Exception):
    """The reconstruction exceeded its per-run time budget; child was killed."""


class ReconstructionCrashed(Exception):
    """The worker process died (native crash/segfault) without a result."""


class ReconstructionError(Exception):
    """The reconstruction raised an ordinary Python exception in the worker."""


def _worker(conn, fn: Callable, args: tuple, kwargs: dict, stream: bool) -> None:
    """Child entrypoint: run ``fn`` and ship a tagged result back over ``conn``."""
    try:
        if stream:
            kwargs = {
                **kwargs,
                "progress": lambda snapshot: conn.send(("progress", snapshot)),
            }
        result = fn(*args, **kwargs)
        conn.send(("ok", result))
    except Exception as exc:  # ordinary failure -> report cleanly to the parent
        conn.send(("error", f"{type(exc).__name__}: {exc}"))
    finally:
        conn.close()


def _reap(proc: mp.Process) -> None:
    if proc.is_alive():
        proc.kill()
    proc.join(_JOIN_GRACE_SECONDS)


def _run_in_process(
    fn: Callable[..., Any],
    *,
    args: tuple,
    kwargs: dict,
    timeout: float,
    on_progress: Callable[[Any], None] | None,
) -> Any:
    ctx = mp.get_context("spawn")
    parent_conn, child_conn = ctx.Pipe(duplex=False)
    proc = ctx.Process(
        target=_worker,
        args=(child_conn, fn, args, kwargs, on_progress is not None),
        daemon=True,
    )
    proc.start()
    child_conn.close()  # only the child writes; lets recv see EOF if it dies

    status: str | None = None
    payload: Any = None
    deadline = time.monotonic() + timeout
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not parent_conn.poll(remaining):
                raise ReconstructionTimeout("Reconstruction exceeded the time limit")
            try:
                status, payload = parent_conn.recv()
            except EOFError:  # child died mid-/pre-send (native crash)
                status = None
                break
            if status == "progress":
                if on_progress is not None:
                    try:
                        on_progress(payload)
                    except Exception:  # a persist hiccup must not abort the run
                        logger.warning("progress callback failed", exc_info=True)
                continue
            break  # ("ok", ...) or ("error", ...) — the terminal message
    finally:
        parent_conn.close()
        _reap(proc)

    if status == "ok":
        return payload
    if status == "error":
        raise ReconstructionError(str(payload))
    raise ReconstructionCrashed(
        f"Reconstruction worker exited unexpectedly (exit code {proc.exitcode})"
    )


def run_reconstruction_isolated(
    images: list[tuple[str, bytes]],
    *,
    quality: str,
    matcher: str,
    enable_dense: bool,
    device: str | None,
    timeout: float,
    on_progress: Callable[[Any], None] | None = None,
) -> ColmapResult:
    """Run :func:`app.repo.colmap_engine.run_reconstruction` in a child process.

    ``on_progress`` receives each live stage snapshot (a ``list[dict]``) so the
    parent can persist progress mid-run.
    """
    return _run_in_process(
        run_reconstruction,
        args=(images,),
        kwargs={
            "quality": quality,
            "matcher": matcher,
            "enable_dense": enable_dense,
            "device": device,
        },
        timeout=timeout,
        on_progress=on_progress,
    )
