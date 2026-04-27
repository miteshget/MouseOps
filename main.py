import asyncio
import datetime
import hashlib
import ipaddress
import json
import os
import re
import secrets
import stat
import sys
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Literal, Optional

from cryptography.fernet import Fernet, InvalidToken
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from contextlib import asynccontextmanager
from fastapi import Cookie, Depends, FastAPI, HTTPException, Path as FPath, Response
from fastapi.responses import StreamingResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator
import httpx

# ── Validation patterns ───────────────────────────────────────────────────────
_URL_RE    = re.compile(r'^https?://.{1,490}$', re.IGNORECASE)
_MODULE_RE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9\-\.]{0,99}$')

DATA_FILE      = Path("cis.json")
USERS_FILE     = Path("users.json")
LOGS_DIR       = Path("logs")
SEQ_STATE_FILE = Path("seq_state.json")
KEY_FILE       = Path(".secret.key")

_file_lock = threading.Lock()   # protects all file writes throughout the module

# ── TLS / ports ───────────────────────────────────────────────────────────────
SSL_DIR   = Path(".ssl")
SSL_CERT  = SSL_DIR / "cert.pem"
SSL_KEY   = SSL_DIR / "key.pem"

HTTP_PORT  = int(os.getenv("MOUSEOPS_HTTP_PORT",  "8765"))
HTTPS_PORT = int(os.getenv("MOUSEOPS_HTTPS_PORT", "8766"))


def _ensure_ssl_cert() -> None:
    """Generate a self-signed TLS cert valid for 10 years if one doesn't exist."""
    if SSL_CERT.exists() and SSL_KEY.exists():
        return
    SSL_DIR.mkdir(exist_ok=True)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "MouseOps"),
        x509.NameAttribute(NameOID.COMMON_NAME, "localhost"),
    ])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
        .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3650))
        .add_extension(
            x509.SubjectAlternativeName([
                x509.DNSName("localhost"),
                x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
            ]),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    SSL_KEY.write_bytes(key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ))
    SSL_KEY.chmod(stat.S_IRUSR | stat.S_IWUSR)   # 0o600
    SSL_CERT.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    print(f"Generated self-signed TLS cert → {SSL_CERT}", file=sys.stderr)


HTTPS_MODE = os.getenv("MOUSEOPS_MODE", "https") == "https"

# Generate cert only when running in HTTPS mode
if HTTPS_MODE:
    _ensure_ssl_cert()

# ── Token encryption ──────────────────────────────────────────────────────────
def _load_or_create_key() -> bytes:
    # Lock prevents two processes generating different keys simultaneously (Bug 8)
    with _file_lock:
        if KEY_FILE.exists():
            return KEY_FILE.read_bytes()
        key = Fernet.generate_key()
        KEY_FILE.write_bytes(key)
        KEY_FILE.chmod(stat.S_IRUSR | stat.S_IWUSR)   # 0o600 — owner only
        return key

_fernet = Fernet(_load_or_create_key())


def encrypt_token(token: str) -> str:
    if not token:
        return ""
    return _fernet.encrypt(token.encode()).decode()


def decrypt_token(value: str) -> str:
    """Decrypt a token. Falls back to returning the value as-is for legacy plaintext."""
    if not value:
        return ""
    try:
        return _fernet.decrypt(value.encode()).decode()
    except (InvalidToken, Exception):
        return value   # old plaintext — will be encrypted on next save

# Hard lockdown: set MOUSEOPS_READONLY=1 to block writes even for admins
READONLY: bool = os.getenv("MOUSEOPS_READONLY", "").lower() in ("1", "true", "yes")

# In-memory session store  {token → {username, role, expires}}
_sessions: dict = {}

# ── Active run registries ─────────────────────────────────────────────────────
_run_active: dict = {}   # (ci_id, stage, module) → stream state
_seq_active: dict = {}   # ci_id → sequential run state


# ── User helpers ──────────────────────────────────────────────────────────────
def _hash_pw(password: str, salt: str | None = None):
    if salt is None:
        salt = secrets.token_hex(16)
    h = hashlib.sha256(f"{salt}{password}".encode()).hexdigest()
    return h, salt


def _verify_pw(password: str, hashed: str, salt: str) -> bool:
    return hashlib.sha256(f"{salt}{password}".encode()).hexdigest() == hashed


def load_users() -> list:
    if USERS_FILE.exists():
        return json.loads(USERS_FILE.read_text())
    # Bootstrap default admin
    h, s = _hash_pw("mouseops")
    default = [{"username": "admin", "password_hash": h, "salt": s, "role": "admin"}]
    save_users(default)
    return default


def save_users(users: list) -> None:
    with _file_lock:
        USERS_FILE.write_text(json.dumps(users, indent=2))


# ── Auth dependencies ─────────────────────────────────────────────────────────
def get_current_user(mouseops_session: Optional[str] = Cookie(None)) -> dict:
    if not mouseops_session:
        raise HTTPException(401, "Not authenticated — please log in")
    session = _sessions.get(mouseops_session)
    if not session or session["expires"] < time.time():
        _sessions.pop(mouseops_session, None)
        raise HTTPException(401, "Session expired — please log in again")
    session["expires"] = time.time() + 8 * 3600   # rolling window
    return session


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(403, "Admin access required")
    return user


def require_write(user: dict = Depends(get_current_user)) -> dict:
    if READONLY:
        raise HTTPException(403, "Server is in read-only mode (MOUSEOPS_READONLY=1)")
    if user["role"] != "admin":
        raise HTTPException(403, "Admin access required for write operations")
    return user


def load_cis() -> list:
    if not DATA_FILE.exists():
        return []
    cis = json.loads(DATA_FILE.read_text())
    for ci in cis:
        if ci.get("token"):
            ci["token"] = decrypt_token(ci["token"])   # transparent decryption
    return cis


def save_cis(cis: list) -> None:
    encrypted = []
    for ci in cis:
        ec = dict(ci)
        if ec.get("token"):
            ec["token"] = encrypt_token(ec["token"])   # encrypt before writing
        encrypted.append(ec)
    with _file_lock:
        DATA_FILE.write_text(json.dumps(encrypted, indent=2))


# ── Sequential run state persistence ─────────────────────────────────────────
def save_seq_state() -> None:
    """Persist all active (non-done) sequential runs so they survive a restart."""
    snapshot = {
        ci_id: {
            "mode":         s["mode"],
            "mods":         s["mods"],
            "currentIdx":   s.get("currentIdx", 0),
        }
        for ci_id, s in _seq_active.items()
        if not s.get("done") and not s.get("stopped")
    }
    with _file_lock:   # prevent concurrent _bg_seq tasks corrupting the file (Bug 3)
        if snapshot:
            SEQ_STATE_FILE.write_text(json.dumps(snapshot, indent=2))
        elif SEQ_STATE_FILE.exists():
            SEQ_STATE_FILE.unlink()


def load_seq_state() -> dict:
    if not SEQ_STATE_FILE.exists():
        return {}
    try:
        return json.loads(SEQ_STATE_FILE.read_text())
    except Exception as e:
        import sys
        print(f"WARNING: Could not load seq_state.json ({e}) — interrupted runs will not resume", file=sys.stderr)
        return {}


@asynccontextmanager
async def _lifespan(app: FastAPI):
    await _on_startup()
    yield


app = FastAPI(title="MouseOps", lifespan=_lifespan)


async def _resume_seq_runs() -> None:
    """On server start, resume any sequential runs that were interrupted."""
    saved = load_seq_state()
    if not saved:
        return
    cis = load_cis()
    for ci_id, snap in saved.items():
        ci = next((c for c in cis if c["id"] == ci_id), None)
        if not ci:
            continue
        state = {
            "mode":         snap["mode"],
            "mods":         snap["mods"],
            "currentIdx":   snap.get("currentIdx", 0),
            "currentMod":   None,
            "currentStage": None,
            "done":         False,
            "stopped":      False,
            "paused":       False,
            "pausedMod":    None,
            "pausedStage":  None,
            "_decision_event": None,
            "decision":     None,
            "_resume_from": snap.get("currentIdx", 0),  # restart from this module
        }
        _seq_active[ci_id] = state
        asyncio.create_task(_bg_seq(ci_id, ci, state))


async def _on_startup() -> None:
    await _resume_seq_runs()
    await _start_http_redirect()


async def _start_http_redirect() -> None:
    """In HTTPS mode: start a lightweight HTTP server that redirects to HTTPS."""
    if not HTTPS_MODE:
        print(f"MouseOps running in HTTP mode on port {HTTP_PORT}", file=sys.stderr)
        return
    async def _handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            data = await asyncio.wait_for(reader.read(4096), timeout=5)
            text = data.decode("utf-8", errors="ignore")
            # Extract request path
            path = "/"
            first = text.split("\n")[0].split()
            if len(first) >= 2:
                path = first[1]
            # Extract Host header to preserve the hostname the client used
            host = "localhost"
            for line in text.split("\n"):
                if line.lower().startswith("host:"):
                    host = line.split(":", 1)[1].strip().split(":")[0]
                    break
            target = f"https://{host}:{HTTPS_PORT}{path}"
            resp = (
                f"HTTP/1.1 301 Moved Permanently\r\n"
                f"Location: {target}\r\n"
                f"Connection: close\r\n"
                f"Content-Length: 0\r\n\r\n"
            )
            writer.write(resp.encode())
            await writer.drain()
        except Exception:
            pass
        finally:
            try:
                writer.close()
            except Exception:
                pass

    try:
        server = await asyncio.start_server(_handler, "0.0.0.0", HTTP_PORT)
        asyncio.create_task(server.serve_forever())
        print(f"HTTP  → http://127.0.0.1:{HTTP_PORT}  (redirects to HTTPS)", file=sys.stderr)
        print(f"HTTPS → https://127.0.0.1:{HTTPS_PORT}", file=sys.stderr)
    except OSError as e:
        print(f"WARNING: Could not start HTTP redirect on port {HTTP_PORT}: {e}", file=sys.stderr)


# ── Pydantic models ───────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _pw(cls, v):
        if len(v) < 4:
            raise ValueError("Password must be at least 4 characters")
        return v


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: Literal["admin", "viewer"] = "viewer"

    @field_validator("username")
    @classmethod
    def _uname(cls, v):
        v = v.strip()
        if not re.match(r'^[a-zA-Z0-9_\-]{2,32}$', v):
            raise ValueError("Username must be 2–32 alphanumeric characters")
        return v

    @field_validator("password")
    @classmethod
    def _pw(cls, v):
        if len(v) < 4:
            raise ValueError("Password must be at least 4 characters")
        return v


class UpdateUserRequest(BaseModel):
    role: Optional[Literal["admin", "viewer"]] = None
    new_password: Optional[str] = None


class CIConfig(BaseModel):
    name: str
    url: str
    token: Optional[str] = ""
    modules: list[str] = []

    @field_validator("name")
    @classmethod
    def _name(cls, v):
        v = v.strip()
        if not v: raise ValueError("Name cannot be empty")
        if len(v) > 200: raise ValueError("Name must be 200 characters or fewer")
        return v

    @field_validator("url")
    @classmethod
    def _url(cls, v):
        v = v.strip().rstrip("/")
        if not _URL_RE.match(v): raise ValueError("URL must start with http:// or https://")
        return v

    @field_validator("token")
    @classmethod
    def _token(cls, v):
        if v and len(v) > 2000: raise ValueError("Token must be 2000 characters or fewer")
        return v or ""

    @field_validator("modules")
    @classmethod
    def _modules(cls, v):
        if len(v) > 500: raise ValueError("Cannot specify more than 500 modules")
        for mod in v:
            if not _MODULE_RE.match(mod): raise ValueError(f'Invalid module name "{mod}"')
        return v


class SeqRequest(BaseModel):
    mode: Literal["solve", "validate", "both"] = "both"
    mods: list[str]


class DecisionRequest(BaseModel):
    decision: Literal["skip", "rerun", "stop"]


# ── Auth endpoints ────────────────────────────────────────────────────────────
@app.post("/api/auth/login")
def login(req: LoginRequest, response: Response):
    users = load_users()
    user  = next((u for u in users if u["username"] == req.username), None)
    if not user or not _verify_pw(req.password, user["password_hash"], user["salt"]):
        raise HTTPException(401, "Invalid username or password")
    token = secrets.token_urlsafe(32)
    _sessions[token] = {
        "username": user["username"],
        "role":     user["role"],
        "expires":  time.time() + 8 * 3600,
    }
    response.set_cookie(
        key="mouseops_session", value=token,
        httponly=True, samesite="strict", max_age=8 * 3600,
        secure=HTTPS_MODE,   # only mark Secure when actually running over HTTPS
    )
    return {"username": user["username"], "role": user["role"], "readonly": READONLY}


@app.post("/api/auth/logout")
def logout(response: Response, user: dict = Depends(get_current_user),
           mouseops_session: Optional[str] = Cookie(None)):
    _sessions.pop(mouseops_session, None)
    response.delete_cookie("mouseops_session")
    return {"ok": True}


@app.get("/api/auth/me")
def me(user: dict = Depends(get_current_user)):
    return {"username": user["username"], "role": user["role"], "readonly": READONLY}


@app.post("/api/auth/change-password")
def change_password(req: ChangePasswordRequest, user: dict = Depends(get_current_user)):
    users = load_users()
    idx   = next((i for i, u in enumerate(users) if u["username"] == user["username"]), None)
    if idx is None:
        raise HTTPException(404, "User not found")
    u = users[idx]
    if not _verify_pw(req.current_password, u["password_hash"], u["salt"]):
        raise HTTPException(401, "Current password is incorrect")
    h, s = _hash_pw(req.new_password)
    users[idx]["password_hash"] = h
    users[idx]["salt"] = s
    save_users(users)
    return {"ok": True}


# ── User management (admin only) ──────────────────────────────────────────────
@app.get("/api/users")
def list_users(_: dict = Depends(require_admin)):
    return [{"username": u["username"], "role": u["role"]} for u in load_users()]


@app.post("/api/users", status_code=201)
def create_user(req: CreateUserRequest, _: dict = Depends(require_admin)):
    users = load_users()
    if any(u["username"] == req.username for u in users):
        raise HTTPException(409, f'User "{req.username}" already exists')
    h, s = _hash_pw(req.password)
    users.append({"username": req.username, "password_hash": h, "salt": s, "role": req.role})
    save_users(users)
    return {"username": req.username, "role": req.role}


@app.put("/api/users/{username}")
def update_user(username: str, req: UpdateUserRequest, admin: dict = Depends(require_admin)):
    users = load_users()
    idx = next((i for i, u in enumerate(users) if u["username"] == username), None)
    if idx is None:
        raise HTTPException(404, "User not found")
    if req.role:
        # Prevent removing the last admin
        if req.role != "admin" and users[idx]["role"] == "admin":
            if sum(1 for u in users if u["role"] == "admin") <= 1:
                raise HTTPException(400, "Cannot demote the last admin account")
        users[idx]["role"] = req.role
    if req.new_password:
        if len(req.new_password) < 4:
            raise HTTPException(422, "Password must be at least 4 characters")
        h, s = _hash_pw(req.new_password)
        users[idx]["password_hash"] = h
        users[idx]["salt"] = s
    save_users(users)
    return {"username": username, "role": users[idx]["role"]}


@app.delete("/api/users/{username}")
def delete_user(username: str, admin: dict = Depends(require_admin)):
    users = load_users()
    u = next((u for u in users if u["username"] == username), None)
    if not u:
        raise HTTPException(404, "User not found")
    if u["role"] == "admin" and sum(1 for x in users if x["role"] == "admin") <= 1:
        raise HTTPException(400, "Cannot delete the last admin account")
    if username == admin["username"]:
        raise HTTPException(400, "Cannot delete your own account")
    save_users([x for x in users if x["username"] != username])
    return {"ok": True}


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "cis": len(load_cis()), "readonly": READONLY}


# ── Active runs ───────────────────────────────────────────────────────────────
@app.get("/api/active-runs")
def active_runs(_: dict = Depends(get_current_user)):
    return [
        {"ci_id": k[0], "stage": k[1], "module": k[2]}
        for k, v in _run_active.items()
        if not v.get("done")
    ]


# ── Sequential run control ────────────────────────────────────────────────────
@app.get("/api/seq-runs")
def seq_runs(_: dict = Depends(get_current_user)):
    return [
        {
            "ci_id": ci_id, "mode": v["mode"], "mods": v["mods"],
            "currentIdx": v["currentIdx"], "currentMod": v["currentMod"],
            "currentStage": v["currentStage"], "total": len(v["mods"]),
            "paused": v.get("paused", False),
            "pausedMod": v.get("pausedMod"), "pausedStage": v.get("pausedStage"),
        }
        for ci_id, v in _seq_active.items()
        if not v.get("done")
    ]


@app.post("/api/seq/{ci_id}")
async def start_seq(
    ci_id: str = FPath(..., pattern=r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    req: SeqRequest = ...,
    _: dict = Depends(require_write),
):
    if ci_id in _seq_active and not _seq_active[ci_id].get("done"):
        raise HTTPException(400, "Sequential run already active for this CI")
    cis = load_cis()
    ci  = next((c for c in cis if c["id"] == ci_id), None)
    if not ci:
        raise HTTPException(404, "CI not found")
    state = {
        "mode": req.mode, "mods": req.mods,
        "currentIdx": 0, "currentMod": None, "currentStage": None,
        "done": False, "stopped": False,
        "paused": False, "pausedMod": None, "pausedStage": None,
        "_decision_event": None, "decision": None,
    }
    _seq_active[ci_id] = state
    asyncio.create_task(_bg_seq(ci_id, ci, state))
    return {"ok": True}


@app.post("/api/seq/{ci_id}/stop")
def stop_seq(
    ci_id: str = FPath(..., pattern=r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    _: dict = Depends(require_write),
):
    seq = _seq_active.get(ci_id)
    if not seq or seq.get("done"):
        raise HTTPException(404, "No active sequential run")
    seq["stopped"] = True
    event = seq.get("_decision_event")
    if event:
        seq["decision"] = "stop"
        event.set()
    return {"ok": True}


@app.post("/api/seq/{ci_id}/decision")
def seq_decision(
    ci_id: str = FPath(..., pattern=r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    req: DecisionRequest = ...,
    _: dict = Depends(require_write),
):
    seq = _seq_active.get(ci_id)
    if not seq or not seq.get("paused"):
        raise HTTPException(404, "No paused sequential run")
    seq["decision"] = req.decision
    if req.decision == "stop":
        seq["stopped"] = True
    event = seq.get("_decision_event")
    if event:
        event.set()
    return {"ok": True}


# ── CI CRUD ───────────────────────────────────────────────────────────────────
def _strip_token(ci: dict) -> dict:
    """Return a CI dict with the token removed — tokens must never leave the server."""
    return {k: v for k, v in ci.items() if k != "token"}


@app.get("/api/cis")
def get_cis(_: dict = Depends(get_current_user)):
    return [_strip_token(ci) for ci in load_cis()]


@app.post("/api/cis", status_code=201)
def create_ci(ci: CIConfig, _: dict = Depends(require_write)):
    cis = load_cis()
    entry = {**ci.model_dump(), "id": str(uuid.uuid4())}
    cis.append(entry)
    save_cis(cis)
    return _strip_token(entry)


@app.put("/api/cis/{ci_id}")
def update_ci(ci_id: str, ci: CIConfig, _: dict = Depends(require_write)):
    cis = load_cis()
    for i, c in enumerate(cis):
        if c["id"] == ci_id:
            new = {**ci.model_dump(), "id": ci_id}
            # c["token"] is plaintext (decrypted by load_cis); save_cis will encrypt it
            if not new.get("token") and c.get("token"):
                new["token"] = c["token"]
            cis[i] = new
            save_cis(cis)
            return _strip_token(cis[i])   # never send token back to client (Bug 2)
    raise HTTPException(status_code=404, detail="CI not found")


@app.delete("/api/cis/{ci_id}")
def delete_ci(ci_id: str, _: dict = Depends(require_write)):
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
    _: dict = Depends(get_current_user),
):
    log_file = LOGS_DIR / ci_id / module_name / f"{stage}.log"
    if not log_file.exists():
        raise HTTPException(status_code=404, detail="No log found")
    return PlainTextResponse(log_file.read_text(errors="replace"))


# ── Background stream (one module/stage) ──────────────────────────────────────
async def _bg_stream(run_key: tuple, url: str, req_headers: dict,
                     state: dict, log_fh) -> None:
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
                    tee(msg); emit(json.dumps(msg)); emit("__DONE_FAIL__")
                    return
                async for chunk in resp.aiter_bytes():
                    for line in chunk.decode("utf-8", errors="replace").split("\n"):
                        if line.startswith("data: "):
                            raw = line[6:].strip()
                            tee(raw)
                            broadcast(f"data: {raw}\n\n".encode())
    except httpx.ConnectError:
        msg = f"❌ Cannot connect to Showroom at {url}"
        tee(msg); emit(json.dumps(msg)); emit("__DONE_FAIL__")
    except Exception as e:
        msg = f"❌ Proxy error: {e}"
        tee(msg); emit(json.dumps(msg)); emit("__DONE_FAIL__")
    finally:
        log_fh.close()
        state["done"] = True
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


async def _run_stage_and_wait(ci_id, stage, mod, ci, seq_state):
    run_key = (ci_id, stage, mod)
    url = f"{ci['url'].rstrip('/')}/stream/{stage}/{mod}"
    req_headers = {"Accept": "text/event-stream", "Cache-Control": "no-cache"}
    if ci.get("token"):
        req_headers["Authorization"] = f"Bearer {ci['token']}"
    run_state: dict = {"subscribers": [], "buffer": deque(maxlen=1000), "done": False}
    _run_active[run_key] = run_state
    log_dir = LOGS_DIR / ci_id / mod
    log_dir.mkdir(parents=True, exist_ok=True)
    log_fh = open(log_dir / f"{stage}.log", "w", encoding="utf-8")
    task = asyncio.create_task(_bg_stream(run_key, url, req_headers, run_state, log_fh))
    while not run_state.get("done"):
        if seq_state.get("stopped"):
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            return "stopped"
        await asyncio.sleep(0.2)
    try:
        await task
    except Exception:
        pass
    buf = list(run_state["buffer"])
    if any(b"__DONE_FAIL__" in e for e in buf[-3:]):
        return "fail"
    if any(b'"fatal:' in e or b'"failed:' in e for e in buf):
        return "fail"
    return "ok"


async def _ask_decision(seq_state, mod, stage):
    event = asyncio.Event()
    seq_state.update({"paused": True, "pausedMod": mod, "pausedStage": stage,
                       "_decision_event": event, "decision": None})
    await event.wait()
    seq_state["paused"] = False
    seq_state["_decision_event"] = None
    return seq_state.get("decision", "stop")


async def _run_module(ci_id, mod, mode, ci, seq_state):
    if mode != "validate":
        while True:
            if seq_state.get("stopped"):
                return "stop"
            seq_state["currentStage"] = "solve"
            result = await _run_stage_and_wait(ci_id, "solve", mod, ci, seq_state)
            if result == "stopped": return "stop"
            if result == "ok": break
            decision = await _ask_decision(seq_state, mod, "solve")
            if decision == "stop": return "stop"
            if decision == "skip": return "skip"
    if mode != "solve":
        while True:
            if seq_state.get("stopped"):
                return "stop"
            seq_state["currentStage"] = "validate"
            result = await _run_stage_and_wait(ci_id, "validate", mod, ci, seq_state)
            if result == "stopped": return "stop"
            if result == "ok": break
            decision = await _ask_decision(seq_state, mod, "validate")
            if decision == "stop": return "stop"
            if decision == "skip": return "skip"
    return "ok"


async def _bg_seq(ci_id, ci, state):
    resume_from = state.pop("_resume_from", 0)
    for i, mod in enumerate(state["mods"]):
        if i < resume_from:
            continue   # skip already-completed modules
        if state.get("stopped"):
            break
        state["currentIdx"] = i
        state["currentMod"] = mod
        state["currentStage"] = None
        save_seq_state()   # persist progress before each module
        result = await _run_module(ci_id, mod, state["mode"], ci, state)
        if result == "stop" or state.get("stopped"):
            break
    state["done"] = True
    save_seq_state()   # cleans up the saved state
    async def _cleanup():
        await asyncio.sleep(10)
        _seq_active.pop(ci_id, None)
    asyncio.create_task(_cleanup())


# ── SSE stream endpoint ───────────────────────────────────────────────────────
@app.get("/api/stream/{ci_id}/{stage}/{module_name}")
async def proxy_stream(
    ci_id:       str = FPath(..., pattern=r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    stage:       str = FPath(..., pattern=r'^(solve|validate)$'),
    module_name: str = FPath(..., pattern=r'^[a-zA-Z0-9][a-zA-Z0-9\-\.]{0,99}$'),
    user: dict = Depends(get_current_user),
):
    run_key = (ci_id, stage, module_name)

    # Viewers may join EXISTING streams but not start new ones
    if run_key not in _run_active or _run_active[run_key].get("done"):
        if READONLY or user["role"] != "admin":
            raise HTTPException(403, "Viewers cannot start new streams")
        cis = load_cis()
        ci  = next((c for c in cis if c["id"] == ci_id), None)
        if not ci:
            raise HTTPException(404, "CI not found")
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
            for event in list(state["buffer"]):
                yield event
                if b"__DONE__" in event:
                    done_in_buffer = True
                    break
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
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


app.mount("/", StaticFiles(directory="static", html=True), name="static")
