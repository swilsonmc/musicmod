import shutil
import threading
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import BackgroundTasks, Body, FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from . import config, db
from .separation import separate_upload
from .transcription import GM_PROGRAM, METHOD_BY_STEM, notes_json, save_notes, transcribe_stems
from .youtube import download_video, ensure_ytdlp_updated, extract_audio, fetch_metadata, probe_media

app = FastAPI(title="musicmod")

STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

UPLOAD_COLUMNS = (
    "id, original_filename, status, error, file_size_bytes, progress, "
    "created_at, started_at, finished_at, "
    "transcribe_status, transcribe_progress, transcribe_error, transcribe_started_at, transcribe_finished_at"
)

# Separation and transcription are CPU-bound and one job already uses every
# core on a laptop with no GPU (see HANDOFF.md) — running two at once would
# just make both slower and the recorded timings meaningless. Queue instead.
_cpu_lock = threading.Lock()


@app.on_event("startup")
def on_startup() -> None:
    for d in (config.UPLOADS_DIR, config.STEMS_DIR, config.MODELS_DIR, config.MIDI_DIR, config.DOWNLOADS_DIR):
        d.mkdir(parents=True, exist_ok=True)
    db.init_schema()

    # Stopping the server kills any running job with it; without this the
    # upload would show "processing" forever.
    now = datetime.now()
    db.execute(
        "UPDATE uploads SET status = 'error', progress = NULL, finished_at = %s, error = %s "
        "WHERE status IN ('pending', 'processing')",
        (now, "Interrupted — the server was stopped before this finished. Upload it again to retry."),
    )
    db.execute(
        "UPDATE uploads SET transcribe_status = 'error', transcribe_progress = NULL, "
        "transcribe_finished_at = %s, transcribe_error = %s "
        "WHERE transcribe_status IN ('pending', 'processing')",
        (now, "Interrupted — the server was stopped before this finished. Click Transcribe to retry."),
    )
    db.execute(
        "UPDATE downloads SET status = 'error', progress = NULL, finished_at = %s, error = %s "
        "WHERE status IN ('pending', 'downloading', 'extracting')",
        (now, "Interrupted — the server was stopped before this finished. Download it again to retry."),
    )


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse((STATIC_DIR / "index.html").read_text())


@app.get("/archive", response_class=HTMLResponse)
def archive() -> HTMLResponse:
    return HTMLResponse((STATIC_DIR / "archive.html").read_text())


@app.get("/downloads", response_class=HTMLResponse)
def downloads_page() -> HTMLResponse:
    return HTMLResponse((STATIC_DIR / "downloads.html").read_text())


def _progress_text(stage: int, total: int, pct: int | None, detail: str) -> str:
    """Packs (stage, total, pct, detail) into one string for the `progress`/
    `transcribe_progress` VARCHAR columns, in a format the frontend's
    formatProgress() can parse back out — see format.js. pct is left blank
    (not "None"/"null") when not yet known, so the regex stays simple."""
    return f"{stage}/{total}|{'' if pct is None else pct}|{detail}"


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

    _set(upload_id, progress="Queued — waiting for another job to finish")
    separated = False
    with _cpu_lock:
        _set(upload_id, status="processing", started_at=datetime.now(), progress="Starting…")
        try:
            stems = separate_upload(
                input_path, output_dir,
                lambda stage, total, pct, detail: _set(upload_id, progress=_progress_text(stage, total, pct, detail)),
            )
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
            separated = True
        except Exception as exc:  # separation failures are expected (bad input, OOM) — record, don't crash the server
            _set(upload_id, status="error", finished_at=datetime.now(), error=str(exc)[:1000], progress=None)

    # Transcription costs ~1% of separation time, so just do it. Outside the
    # lock block above because the lock isn't reentrant.
    if separated:
        _set(upload_id, transcribe_status="pending", transcribe_progress="Queued")
        _run_transcription(upload_id, stored_dir)


def _run_transcription(upload_id: int, stored_dir: str) -> None:
    _set(upload_id, transcribe_progress="Queued — waiting for another job to finish")
    with _cpu_lock:
        _set(upload_id, transcribe_status="processing", transcribe_started_at=datetime.now(),
             transcribe_finished_at=None, transcribe_error=None, transcribe_progress="Starting…")
        try:
            stems = {
                row["stem_name"]: config.STEMS_DIR / row["file_path"]
                for row in db.fetch_all("SELECT stem_name, file_path FROM stems WHERE upload_id = %s", (upload_id,))
            }
            results = transcribe_stems(
                stems, config.MIDI_DIR / stored_dir,
                lambda stage, total, pct, detail: _set(
                    upload_id, transcribe_progress=_progress_text(stage, total, pct, detail)
                ),
            )
            db.execute("DELETE FROM midi_tracks WHERE upload_id = %s", (upload_id,))
            for stem_name, (path, method, note_count) in results.items():
                db.execute(
                    "INSERT INTO midi_tracks (upload_id, stem_name, file_path, method, note_count) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    (upload_id, stem_name, str(path.relative_to(config.MIDI_DIR)), method, note_count),
                )
            _set(upload_id, transcribe_status="done", transcribe_finished_at=datetime.now(), transcribe_progress="Done")
        except Exception as exc:  # record, don't crash the server
            _set(upload_id, transcribe_status="error", transcribe_finished_at=datetime.now(),
                 transcribe_error=str(exc)[:1000], transcribe_progress=None)


def _enqueue_upload(original_filename: str, source_path: Path, background_tasks: BackgroundTasks) -> int:
    """Registers an already-on-disk audio file as an upload and queues
    separation. Shared by create_upload() (a fresh multipart file) and
    start_download_separation() (audio ffmpeg already extracted from a
    YouTube download) — same job from here on in either case."""
    stored_dir = str(uuid.uuid4())
    dest_dir = config.UPLOADS_DIR / stored_dir
    dest_dir.mkdir(parents=True)
    dest_path = dest_dir / f"original{source_path.suffix.lower()}"
    shutil.copyfile(source_path, dest_path)
    file_size_bytes = dest_path.stat().st_size

    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO uploads (original_filename, stored_dir, status, file_size_bytes) "
                "VALUES (%s, %s, 'pending', %s)",
                (original_filename, stored_dir, file_size_bytes),
            )
            upload_id = cur.lastrowid
    finally:
        conn.close()

    background_tasks.add_task(_run_separation, upload_id, stored_dir)
    return upload_id


@app.post("/api/uploads")
async def create_upload(file: UploadFile, background_tasks: BackgroundTasks):
    # _enqueue_upload() (and _enqueue_video_extraction() below) expect a file
    # already on disk (so a download's extracted audio can be reused
    # byte-for-byte without a second copy); a fresh multipart upload needs
    # writing out first.
    suffix = Path(file.filename).suffix.lower() or ".bin"
    tmp_dir = config.UPLOADS_DIR / f"tmp-{uuid.uuid4()}"
    tmp_dir.mkdir(parents=True)
    tmp_path = tmp_dir / f"incoming{suffix}"
    try:
        with tmp_path.open("wb") as out:
            shutil.copyfileobj(file.file, out)

        # ffprobe actually opens the file rather than trusting the extension
        # the browser/OS reported — catches a corrupted file or a document
        # someone dragged in by mistake before it ever reaches a model.
        media = probe_media(tmp_path)
        if media is None:
            raise HTTPException(400, "That doesn't look like a usable audio or video file.")

        if media["kind"] == "audio":
            upload_id = _enqueue_upload(file.filename, tmp_path, background_tasks)
            return {"kind": "audio", "id": upload_id, "status": "pending"}

        # Video: extract its audio first and let the user confirm before
        # committing to a full separation run — reuses the `downloads`
        # table's existing extracted-audio -> "Separate stems" flow (see
        # downloads.js) instead of a second state machine for this case.
        download_id = _enqueue_video_extraction(file.filename, tmp_path, media["duration_seconds"], background_tasks)
        return {"kind": "video", "download_id": download_id, "status": "pending"}
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


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
            cur.execute("SELECT stem_name, method, note_count FROM midi_tracks WHERE upload_id = %s", (upload_id,))
            upload["midi"] = {
                row["stem_name"]: {
                    "method": row["method"],
                    "note_count": row["note_count"],
                    "url": f"/api/uploads/{upload_id}/midi/{row['stem_name']}",
                    "notes_url": f"/api/uploads/{upload_id}/midi/{row['stem_name']}/notes",
                }
                for row in cur.fetchall()
            }
            # Stems no transcriber handles yet (drums), so the UI can say so instead of looking broken.
            upload["untranscribable"] = [s for s in upload["stems"] if s not in METHOD_BY_STEM]
            upload["original_url"] = f"/api/uploads/{upload_id}/original"
            return upload
    finally:
        conn.close()


@app.post("/api/uploads/{upload_id}/transcribe")
def start_transcription(upload_id: int, background_tasks: BackgroundTasks):
    row = db.fetch_one("SELECT status, stored_dir, transcribe_status FROM uploads WHERE id = %s", (upload_id,))
    if row is None:
        raise HTTPException(404, "No such upload")
    if row["status"] != "done":
        raise HTTPException(409, "Stems aren't separated yet")
    if row["transcribe_status"] in ("pending", "processing"):
        raise HTTPException(409, "Already transcribing")
    _set(upload_id, transcribe_status="pending", transcribe_error=None, transcribe_progress="Queued")
    background_tasks.add_task(_run_transcription, upload_id, row["stored_dir"])
    return {"id": upload_id, "transcribe_status": "pending"}


def _midi_path(upload_id: int, stem_name: str) -> tuple[Path, str]:
    row = db.fetch_one(
        "SELECT m.file_path, u.original_filename FROM midi_tracks m JOIN uploads u ON u.id = m.upload_id "
        "WHERE m.upload_id = %s AND m.stem_name = %s",
        (upload_id, stem_name),
    )
    if row is None:
        raise HTTPException(404, "No MIDI for that stem")
    return config.MIDI_DIR / row["file_path"], row["original_filename"]


@app.get("/api/uploads/{upload_id}/midi/{stem_name}")
def get_midi(upload_id: int, stem_name: str):
    path, original = _midi_path(upload_id, stem_name)
    return FileResponse(path, media_type="audio/midi", filename=f"{Path(original).stem} - {stem_name}.mid")


@app.get("/api/uploads/{upload_id}/midi/{stem_name}/notes")
def get_midi_notes(upload_id: int, stem_name: str):
    path, _ = _midi_path(upload_id, stem_name)
    return {"notes": notes_json(path)}


@app.put("/api/uploads/{upload_id}/midi/{stem_name}/notes")
def put_midi_notes(upload_id: int, stem_name: str, notes: list[list[float]] = Body(..., embed=True)):
    path, _ = _midi_path(upload_id, stem_name)
    is_drum = stem_name == "drums"
    count = save_notes(path, notes, is_drum, GM_PROGRAM.get(stem_name, 0))
    db.execute(
        "UPDATE midi_tracks SET note_count = %s WHERE upload_id = %s AND stem_name = %s",
        (count, upload_id, stem_name),
    )
    return {"note_count": count}


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


@app.get("/api/uploads/{upload_id}/original")
def get_original(upload_id: int):
    row = db.fetch_one("SELECT stored_dir, original_filename FROM uploads WHERE id = %s", (upload_id,))
    if row is None:
        raise HTTPException(404, "No such upload")
    upload_dir = config.UPLOADS_DIR / row["stored_dir"]
    # Stored as "original<ext>" by _enqueue_upload() — same iterdir() pattern
    # _run_separation() already uses to find it without tracking the suffix separately.
    try:
        path = next(upload_dir.iterdir())
    except (FileNotFoundError, StopIteration):
        raise HTTPException(404, "Original file is missing")
    return FileResponse(path, filename=row["original_filename"])


DOWNLOAD_COLUMNS = (
    "id, url, title, status, progress, error, file_size_bytes, duration_seconds, "
    "upload_id, created_at, started_at, finished_at"
)


def _set_download(download_id: int, **fields) -> None:
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            set_clause = ", ".join(f"{k} = %s" for k in fields)
            cur.execute(f"UPDATE downloads SET {set_clause} WHERE id = %s", (*fields.values(), download_id))
    finally:
        conn.close()


def _run_download(download_id: int, url: str, stored_dir: str) -> None:
    """Downloads never compete with separation/transcription for the CPU
    lock above — they're network- and ffmpeg-bound, not the heavy model
    inference that lock exists to serialize, so several can run at once."""
    dest_dir = config.DOWNLOADS_DIR / stored_dir
    dest_dir.mkdir(parents=True)
    _set_download(download_id, status="downloading", started_at=datetime.now())
    try:
        ensure_ytdlp_updated(lambda text: _set_download(download_id, progress=text))

        meta = fetch_metadata(url)
        _set_download(download_id, title=meta["title"][:500], duration_seconds=meta["duration_seconds"])

        video_path = download_video(url, dest_dir, lambda text: _set_download(download_id, progress=text))

        _set_download(download_id, status="extracting", progress="Extracting audio…")
        audio_path = dest_dir / "audio.wav"
        extract_audio(
            video_path, audio_path, meta["duration_seconds"],
            lambda text: _set_download(download_id, progress=text),
        )

        _set_download(
            download_id, status="done", finished_at=datetime.now(), progress="Done",
            file_size_bytes=audio_path.stat().st_size,
        )
    except Exception as exc:  # bad URL, region/age-restricted video, yt-dlp/ffmpeg failure — record, don't crash the server
        _set_download(download_id, status="error", finished_at=datetime.now(), error=str(exc)[:1000], progress=None)


def _run_extract_only(download_id: int, video_path: Path, duration_seconds: float | None) -> None:
    """Same shape as _run_download() but for a video the user already has
    locally (dropped onto the page) — no yt-dlp step, straight to ffmpeg."""
    _set_download(download_id, status="extracting", started_at=datetime.now(), progress="Extracting audio…")
    try:
        audio_path = video_path.parent / "audio.wav"
        extract_audio(
            video_path, audio_path, duration_seconds,
            lambda text: _set_download(download_id, progress=text),
        )
        _set_download(
            download_id, status="done", finished_at=datetime.now(), progress="Done",
            file_size_bytes=audio_path.stat().st_size,
        )
    except Exception as exc:  # corrupt/unsupported video stream, ffmpeg failure — record, don't crash the server
        _set_download(download_id, status="error", finished_at=datetime.now(), error=str(exc)[:1000], progress=None)


def _enqueue_video_extraction(
    original_filename: str, source_path: Path, duration_seconds: float | None, background_tasks: BackgroundTasks
) -> int:
    """Registers a dropped video file as a `downloads` row (same table/flow
    YouTube downloads use once their audio is extracted) and queues
    extraction. Separation isn't started automatically — the "Separate
    stems"/"Transcribe now" step stays a deliberate second click, same as
    for a YouTube download, since extraction is quick but separation is not."""
    stored_dir = str(uuid.uuid4())
    dest_dir = config.DOWNLOADS_DIR / stored_dir
    dest_dir.mkdir(parents=True)
    dest_path = dest_dir / f"video{source_path.suffix.lower()}"
    shutil.copyfile(source_path, dest_path)

    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO downloads (url, title, stored_dir, status, duration_seconds) "
                "VALUES (%s, %s, %s, 'pending', %s)",
                (f"(dropped file) {original_filename}", original_filename, stored_dir, duration_seconds),
            )
            download_id = cur.lastrowid
    finally:
        conn.close()

    background_tasks.add_task(_run_extract_only, download_id, dest_path, duration_seconds)
    return download_id


@app.post("/api/downloads")
def create_download(background_tasks: BackgroundTasks, url: str = Body(..., embed=True)):
    url = url.strip()
    if not url:
        raise HTTPException(400, "No URL given")

    stored_dir = str(uuid.uuid4())
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO downloads (url, stored_dir, status) VALUES (%s, %s, 'pending')",
                (url, stored_dir),
            )
            download_id = cur.lastrowid
    finally:
        conn.close()

    background_tasks.add_task(_run_download, download_id, url, stored_dir)
    return {"id": download_id, "status": "pending"}


@app.get("/api/downloads")
def list_downloads():
    return db.fetch_all(f"SELECT {DOWNLOAD_COLUMNS} FROM downloads ORDER BY id DESC")


@app.get("/api/downloads/{download_id}")
def get_download(download_id: int):
    row = db.fetch_one(f"SELECT {DOWNLOAD_COLUMNS} FROM downloads WHERE id = %s", (download_id,))
    if row is None:
        raise HTTPException(404, "No such download")
    return row


@app.delete("/api/downloads/{download_id}")
def delete_download(download_id: int):
    row = db.fetch_one("SELECT stored_dir, status FROM downloads WHERE id = %s", (download_id,))
    if row is None:
        raise HTTPException(404, "No such download")
    if row["status"] in ("pending", "downloading", "extracting"):
        raise HTTPException(409, "Still downloading — wait for it to finish or error out first")
    shutil.rmtree(config.DOWNLOADS_DIR / row["stored_dir"], ignore_errors=True)
    db.execute("DELETE FROM downloads WHERE id = %s", (download_id,))
    return {"deleted": download_id}


@app.post("/api/downloads/{download_id}/separate")
def start_download_separation(download_id: int, background_tasks: BackgroundTasks):
    row = db.fetch_one(
        "SELECT stored_dir, status, title, url FROM downloads WHERE id = %s", (download_id,)
    )
    if row is None:
        raise HTTPException(404, "No such download")
    if row["status"] != "done":
        raise HTTPException(409, "Audio isn't extracted yet")
    audio_path = config.DOWNLOADS_DIR / row["stored_dir"] / "audio.wav"
    if not audio_path.exists():
        raise HTTPException(409, "Extracted audio file is missing")

    upload_id = _enqueue_upload(row["title"] or row["url"], audio_path, background_tasks)
    _set_download(download_id, upload_id=upload_id)
    return {"upload_id": upload_id, "status": "pending"}
