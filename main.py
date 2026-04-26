import asyncio
import threading
import re
from collections import deque
from fastapi import FastAPI, HTTPException, Path as FPath
from fastapi.responses import StreamingResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator
import httpx
import json
import uuid
from pathlib import Path
from typing import Optional

# ── Validation patterns ───────────────────────────────────────────────────────
_URL_RE    = re.compile(r'^https?://.{1,490}$', re.IGNORECASE)
_MODULE_RE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9\-\.]{0,99}$')

DATA_FILE = Path("cis.json")
LOGS_DIR  = Path("logs")

_file_lock = threading.Lock()

# Active-run registry.
# run_key (ci_id, stage, module) → {
#   "subscribers": list[asyncio.Queue],
#   "buffer":      deque[bytes],        ← replay buffer for reconnecting clients
#   "done":        bool,
# }
# The background task (_bg_stream) owns the Showroom connection and
# populates this dict. Client connections only subscribe — they never
# control the upstream connection, so browser refresh / multi-window
# all work transparently.
_run_active: dict = {}


def load_cis() -> list:
    if DATA_FILE.exists():
        return json.loads(DATA_FILE.read_text())
    return []


def save_cis(cis: list) -> None:
    with _file_lock:
        DATA_FILE.write_text(json.dumps(cis, indent=2))


app = FastAPI(title="MouseOps")


class CIConfig(BaseModel):
    name: str
    url: str
    token: Optional[str] = ""
    modules: list[str] = []

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name cannot be empty")
        if len(v) > 200:
            raise ValueError("Name must be 200 characters or fewer")
        return v

    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        v = v.strip().rstrip("/")
        if not _URL_RE.match(v):
            raise ValueError("URL must start with http:// or https://")
        return v

    @field_validator("token")
    @classmethod
    def _token(cls, v: Optional[str]) -> str:
        if v and len(v) > 2000:
            raise ValueError("Token must be 2000 characters or fewer")
        return v or ""

    @field_validator("modules")
    @classmethod
    def _modules(cls, v: list) -> list:
        if len(v) > 500:
            raise ValueError("Cannot specify more than 500 modules")
        for mod in v:
            if not _MODULE_RE.match(mod):
                raise ValueError(f'Invalid module name "{mod}"')
        return v


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "cis": len(load_cis())}


# ── Active runs ───────────────────────────────────────────────────────────────
@app.get("/api/active-runs")
def active_runs():
    return [
        {"ci_id": k[0], "stage": k[1], "module": k[2]}
        for k, v in _run_active.items()
        if not v.get("done")
    ]


# ── CI CRUD ───────────────────────────────────────────────────────────────────
@app.get("/api/cis")
def get_cis():
    return load_cis()


@app.post("/api/cis", status_code=201)
def create_ci(ci: CIConfig):
    cis = load_cis()
    entry = {**ci.model_dump(), "id": str(uuid.uuid4())}
    cis.append(entry)
    save_cis(cis)
    return entry


@app.put("/api/cis/{ci_id}")
def update_ci(ci_id: str, ci: CIConfig):
    cis = load_cis()
    for i, c in enumerate(cis):
        if c["id"] == ci_id:
            new = {**ci.model_dump(), "id": ci_id}
            if not new.get("token") and c.get("token"):
                new["token"] = c["token"]
            cis[i] = new
            save_cis(cis)
            return cis[i]
    raise HTTPException(status_code=404, detail="CI not found")


@app.delete("/api/cis/{ci_id}")
def delete_ci(ci_id: str):
    cis = load_cis()
    new_cis = [c for c in cis if c["id"] != ci_id]
    if len(new_cis) == len(cis):
        raise HTTPException(status_code=404, detail="CI not found")
    save_cis(new_cis)
    return {"ok": True}


# ── Log retrieval ─────────────────────────────────────────────────────────────
@app.get("/api/logs/{ci_id}/{stage}/{module_name}")
def get_log(
    ci_id:       str = FPath(..., pattern=r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    stage:       str = FPath(..., pattern=r'^(solve|validate)$'),
    module_name: str = FPath(..., pattern=r'^[a-zA-Z0-9][a-zA-Z0-9\-\.]{0,99}$'),
):
    log_file = LOGS_DIR / ci_id / module_name / f"{stage}.log"
    if not log_file.exists():
        raise HTTPException(status_code=404, detail="No log found")
    return PlainTextResponse(log_file.read_text(errors="replace"))


# ── Background stream task ────────────────────────────────────────────────────
async def _bg_stream(run_key: tuple, url: str, req_headers: dict,
                     state: dict, log_fh) -> None:
    """
    Owns the Showroom SSE connection independently of any client.
    Clients only subscribe to events — they can connect/disconnect freely
    without affecting this task or each other.
    """
    def broadcast(event: bytes) -> None:
        state["buffer"].append(event)
        for q in state["subscribers"]:
            q.put_nowait(event)

    def tee(raw: str) -> None:
        if not raw or raw in ("__DONE__", "__DONE_FAIL__"):
            return
        try:
            text = json.loads(raw)
        except Exception:
            text = raw
        log_fh.write(str(text) + "\n")
        log_fh.flush()

    def emit(raw: str) -> None:
        broadcast(f"data: {raw}\n\n".encode())

    try:
        async with httpx.AsyncClient(
            verify=False,
            timeout=httpx.Timeout(connect=10.0, read=None, write=None, pool=None),
        ) as client:
            async with client.stream("GET", url, headers=req_headers) as resp:
                if resp.status_code != 200:
                    await resp.aread()
                    msg = f"❌ Showroom unreachable — HTTP {resp.status_code} from {url}"
                    tee(msg)
                    emit(json.dumps(msg))
                    emit("__DONE_FAIL__")
                    return
                async for chunk in resp.aiter_bytes():
                    for line in chunk.decode("utf-8", errors="replace").split("\n"):
                        if line.startswith("data: "):
                            raw = line[6:].strip()
                            tee(raw)
                            broadcast(f"data: {raw}\n\n".encode())
    except httpx.ConnectError:
        msg = f"❌ Cannot connect to Showroom at {url}"
        tee(msg)
        emit(json.dumps(msg))
        emit("__DONE_FAIL__")
    except Exception as e:
        msg = f"❌ Proxy error: {e}"
        tee(msg)
        emit(json.dumps(msg))
        emit("__DONE_FAIL__")
    finally:
        log_fh.close()
        state["done"] = True
        # Unblock any subscribers still waiting
        term = b"data: __DONE_FAIL__\n\n"
        for q in list(state["subscribers"]):
            try:
                q.put_nowait(term)
            except Exception:
                pass
        async def _cleanup():
            await asyncio.sleep(3)
            _run_active.pop(run_key, None)
        asyncio.create_task(_cleanup())


# ── SSE endpoint — subscribe only ─────────────────────────────────────────────
@app.get("/api/stream/{ci_id}/{stage}/{module_name}")
async def proxy_stream(
    ci_id:       str = FPath(..., pattern=r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    stage:       str = FPath(..., pattern=r'^(solve|validate)$'),
    module_name: str = FPath(..., pattern=r'^[a-zA-Z0-9][a-zA-Z0-9\-\.]{0,99}$'),
):
    run_key = (ci_id, stage, module_name)

    if run_key not in _run_active or _run_active[run_key].get("done"):
        # Start a fresh background task
        cis = load_cis()
        ci = next((c for c in cis if c["id"] == ci_id), None)
        if not ci:
            raise HTTPException(status_code=404, detail="CI not found")

        url = f"{ci['url'].rstrip('/')}/stream/{stage}/{module_name}"
        req_headers = {"Accept": "text/event-stream", "Cache-Control": "no-cache"}
        if ci.get("token"):
            req_headers["Authorization"] = f"Bearer {ci['token']}"

        state: dict = {"subscribers": [], "buffer": deque(maxlen=1000), "done": False}
        _run_active[run_key] = state

        log_dir = LOGS_DIR / ci_id / module_name
        log_dir.mkdir(parents=True, exist_ok=True)
        log_fh = open(log_dir / f"{stage}.log", "w", encoding="utf-8")

        asyncio.create_task(_bg_stream(run_key, url, req_headers, state, log_fh))

    state = _run_active[run_key]

    async def client_stream():
        q = asyncio.Queue()
        state["subscribers"].append(q)
        done_in_buffer = False
        try:
            # Replay history first
            for event in list(state["buffer"]):
                yield event
                if b"__DONE__" in event:
                    done_in_buffer = True
                    break
            # Then stream live events
            if not done_in_buffer and not state.get("done"):
                while True:
                    event = await q.get()
                    yield event
                    if b"__DONE__" in event:
                        break
        finally:
            try:
                state["subscribers"].remove(q)
            except ValueError:
                pass

    return StreamingResponse(
        client_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# Static files must be mounted last
app.mount("/", StaticFiles(directory="static", html=True), name="static")
