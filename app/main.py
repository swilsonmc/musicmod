import shutil
import threading
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from . import config, db
from .separation import separate_upload

app = FastAPI(title="musicmod")

STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

ALLOWED_SUFFIXES = {".wav", ".flac", ".mp3", ".ogg", ".m4a"}

UPLOAD_COLUMNS = (
    "id, original_filename, status, error, file_size_bytes, progress, "
    "created_at, started_at, finished_at"
)

# Separation is CPU-bound and already uses every core on a laptop with no
# GPU (see HANDOFF.md) — running two jobs at once would just make both
# slower and make the per-song timings in the archive meaningless. Queue
# instead of running concurrently.
_separation_lock = threading.Lock()


@app.on_event("startup")
def on_startup() -> None:
    config.UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    config.STEMS_DIR.mkdir(parents=True, exist_ok=True)
    db.init_schema()


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse((STATIC_DIR / "index.html").read_text())


@app.get("/archive", response_class=HTMLResponse)
def archive() -> HTMLResponse:
    return HTMLResponse((STATIC_DIR / "archive.html").read_text())


def _set(upload_id: int, **fields) -> None:
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            set_clause = ", ".join(f"{k} = %s" for k in fields)
            cur.execute(f"UPDATE uploads SET {set_clause} WHERE id = %s", (*fields.values(), upload_id))
    finally:
        conn.close()


def _run_separation(upload_id: int, stored_dir: str) -> None:
    input_path = next((config.UPLOADS_DIR / stored_dir).iterdir())
    output_dir = config.STEMS_DIR / stored_dir

    _set(upload_id, progress="Queued — waiting for another separation to finish")
    with _separation_lock:
        _set(upload_id, status="processing", started_at=datetime.now(), progress="Starting…")
        try:
            stems = separate_upload(input_path, output_dir, lambda text: _set(upload_id, progress=text))
            conn = db.get_connection()
            try:
                with conn.cursor() as cur:
                    for stem_name, path in stems.items():
                        rel_path = str(path.relative_to(config.STEMS_DIR))
                        cur.execute(
                            "INSERT INTO stems (upload_id, stem_name, file_path) VALUES (%s, %s, %s)",
                            (upload_id, stem_name, rel_path),
                        )
            finally:
                conn.close()
            _set(upload_id, status="done", finished_at=datetime.now(), progress="Done")
        except Exception as exc:  # separation failures are expected (bad input, OOM) — record, don't crash the server
            _set(upload_id, status="error", finished_at=datetime.now(), error=str(exc)[:1000], progress=None)


@app.post("/api/uploads")
async def create_upload(file: UploadFile, background_tasks: BackgroundTasks):
    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(400, f"Unsupported file type {suffix!r}")

    stored_dir = str(uuid.uuid4())
    dest_dir = config.UPLOADS_DIR / stored_dir
    dest_dir.mkdir(parents=True)
    dest_path = dest_dir / f"original{suffix}"
    with dest_path.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    file_size_bytes = dest_path.stat().st_size

    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO uploads (original_filename, stored_dir, status, file_size_bytes) "
                "VALUES (%s, %s, 'pending', %s)",
                (file.filename, stored_dir, file_size_bytes),
            )
            upload_id = cur.lastrowid
    finally:
        conn.close()

    background_tasks.add_task(_run_separation, upload_id, stored_dir)
    return {"id": upload_id, "status": "pending"}


@app.get("/api/uploads")
def list_uploads():
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT {UPLOAD_COLUMNS} FROM uploads ORDER BY id DESC")
            return cur.fetchall()
    finally:
        conn.close()


@app.get("/api/uploads/{upload_id}")
def get_upload(upload_id: int):
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT {UPLOAD_COLUMNS} FROM uploads WHERE id = %s", (upload_id,))
            upload = cur.fetchone()
            if upload is None:
                raise HTTPException(404, "No such upload")
            cur.execute("SELECT stem_name, file_path FROM stems WHERE upload_id = %s", (upload_id,))
            upload["stems"] = {row["stem_name"]: f"/api/uploads/{upload_id}/stems/{row['stem_name']}" for row in cur.fetchall()}
            return upload
    finally:
        conn.close()


@app.get("/api/uploads/{upload_id}/stems/{stem_name}")
def get_stem(upload_id: int, stem_name: str):
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT file_path FROM stems WHERE upload_id = %s AND stem_name = %s",
                (upload_id, stem_name),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    if row is None:
        raise HTTPException(404, "No such stem")
    return FileResponse(config.STEMS_DIR / row["file_path"], media_type="audio/wav")
