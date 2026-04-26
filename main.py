from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import httpx
import json
import uuid
from pathlib import Path
from typing import Optional

DATA_FILE = Path("cis.json")


def load_cis() -> list:
    if DATA_FILE.exists():
        return json.loads(DATA_FILE.read_text())
    return []


def save_cis(cis: list) -> None:
    DATA_FILE.write_text(json.dumps(cis, indent=2))


app = FastAPI(title="MouseOps")


class CIConfig(BaseModel):
    name: str
    url: str
    token: Optional[str] = ""
    modules: list[str] = []


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
            # Preserve existing token when the edit form leaves it blank
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


@app.get("/api/stream/{ci_id}/{stage}/{module_name}")
async def proxy_stream(ci_id: str, stage: str, module_name: str):
    if stage not in ("solve", "validate"):
        raise HTTPException(status_code=400, detail="stage must be 'solve' or 'validate'")

    cis = load_cis()
    ci = next((c for c in cis if c["id"] == ci_id), None)
    if not ci:
        raise HTTPException(status_code=404, detail="CI not found")

    url = f"{ci['url'].rstrip('/')}/stream/{stage}/{module_name}"
    req_headers = {"Accept": "text/event-stream", "Cache-Control": "no-cache"}
    if ci.get("token"):
        req_headers["Authorization"] = f"Bearer {ci['token']}"

    async def event_stream():
        try:
            # verify=False: internal lab Showrooms commonly use self-signed certs
            async with httpx.AsyncClient(
                verify=False,
                timeout=httpx.Timeout(connect=10.0, read=None, write=None, pool=None),
            ) as client:
                async with client.stream("GET", url, headers=req_headers) as resp:
                    if resp.status_code != 200:
                        body = await resp.aread()
                        msg = f"❌ Showroom unreachable — HTTP {resp.status_code} from {url}"
                        yield f"data: {json.dumps(msg)}\n\n".encode()
                        yield b"data: __DONE_FAIL__\n\n"
                        return
                    async for chunk in resp.aiter_bytes():
                        yield chunk
        except httpx.ConnectError as e:
            yield f"data: {json.dumps(f'❌ Cannot connect to Showroom at {url}')}\n\n".encode()
            yield b"data: __DONE_FAIL__\n\n"
        except Exception as e:
            yield f"data: {json.dumps(f'❌ Proxy error: {e}')}\n\n".encode()
            yield b"data: __DONE_FAIL__\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# Static files must be mounted last
app.mount("/", StaticFiles(directory="static", html=True), name="static")
