# app.py - Production-Ready Forge Downloader Backend
import os
import uuid
import threading
import time
from pathlib import Path
from typing import Dict, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
import yt_dlp
from fastapi.responses import FileResponse, JSONResponse

app = FastAPI(title="Forge Downloader API")

# --- ✅ CORS Middleware (fixes browser CORS errors) ---
# Allows requests only from your frontend domains
ALLOWED_ORIGINS = [
    "https://forgedownloader.com",
    "https://www.forgedownloader.com"
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,   # restrict to your frontend domains
    allow_credentials=True,
    allow_methods=["*"],              # allow GET, POST, etc.
    allow_headers=["*"],              # allow all headers
)

# --- Storage ---
DOWNLOADS_DIR = Path("downloads")
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
FILE_RETENTION_SECONDS = 60 * 60  # 1 hour

# --- Task Store ---
tasks: Dict[str, Dict] = {}
tasks_lock = threading.Lock()

# --- Supported Platforms (for validation) ---
SUPPORTED_DOMAINS = [
    "youtube.com", "youtu.be",
    "tiktok.com",
    "instagram.com",
    "facebook.com", "fb.watch",
    "twitter.com", "x.com",
    "pinterest.com"
]

# --- Request Models ---
class DownloadRequest(BaseModel):
    url: HttpUrl
    type: Optional[str] = "video"  # "video" or "audio"
    quality: Optional[str] = "best"  # 'best' or specific format_id

# --- Utility: URL Validation ---
def is_supported_url(url: str) -> bool:
    return any(domain in url for domain in SUPPORTED_DOMAINS)

# --- Endpoint: Get Video Info ---
@app.post("/get_info")
async def get_info(req: DownloadRequest):
    if not is_supported_url(req.url):
        return JSONResponse(status_code=400, content={"status": "error", "message": "Unsupported platform"})
    try:
        ydl_opts = {"skip_download": True, "quiet": True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(req.url, download=False)
            formats = [
                {
                    "format_id": f.get("format_id"),
                    "ext": f.get("ext"),
                    "resolution": f.get("resolution") or f.get("abr"),
                    "filesize": f.get("filesize") or f.get("filesize_approx"),
                    "note": f.get("format_note")
                }
                for f in info.get("formats", [])
            ]
            return {
                "status": "ok",
                "title": info.get("title"),
                "thumbnail": info.get("thumbnail"),
                "uploader": info.get("uploader"),
                "duration": info.get("duration"),
                "formats": formats
            }
    except Exception:
        return JSONResponse(status_code=400, content={"status": "error", "message": "Failed to fetch media info"})

# --- Endpoint: Start Download ---
@app.post("/download")
async def download(req: DownloadRequest):
    if not is_supported_url(req.url):
        return JSONResponse(status_code=400, content={"status": "error", "message": "Unsupported platform"})

    download_id = str(uuid.uuid4())
    out_template = str(DOWNLOADS_DIR / f"{download_id}.%(ext)s")

    # Initialize task
    with tasks_lock:
        tasks[download_id] = {
            "status": "queued",
            "progress": 0.0,
            "title": None,
            "filepath": None,
            "error": None,
            "cancel": False,
            "created_at": time.time(),
            "completed_at": None
        }

    # --- Progress Hook ---
    def progress_hook(d):
        with tasks_lock:
            t = tasks.get(download_id)
            if not t or t.get("cancel"):
                return
            if d.get("status") == "downloading":
                pct = d.get("percent") or 0.0
                t["progress"] = max(0.0, min(100.0, float(pct)))
                t["status"] = "downloading"
            elif d.get("status") == "finished":
                t["progress"] = 100.0
                t["status"] = "downloading"

    # --- Download Thread ---
    def run_download():
        ydl_opts = {
            "outtmpl": out_template,
            "progress_hooks": [progress_hook],
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True
        }
        if req.type == "audio":
            ydl_opts["format"] = "bestaudio/best"
            ydl_opts["postprocessors"] = [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }]
        elif req.quality != "best":
            ydl_opts["format"] = req.quality
        else:
            ydl_opts["format"] = "bestvideo+bestaudio/best"

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(req.url, download=False)
                title = info.get("title")
                with tasks_lock:
                    tasks[download_id]["title"] = title

                # Cancel check
                with tasks_lock:
                    if tasks[download_id]["cancel"]:
                        tasks[download_id]["status"] = "cancelled"
                        tasks[download_id]["completed_at"] = time.time()
                        return

                ydl.download([req.url])

                outfiles = list(DOWNLOADS_DIR.glob(f"{download_id}.*"))
                if outfiles:
                    filepath = str(outfiles[0].resolve())
                    with tasks_lock:
                        tasks[download_id]["filepath"] = filepath
                        tasks[download_id]["status"] = "done"
                        tasks[download_id]["progress"] = 100.0
                        tasks[download_id]["completed_at"] = time.time()
                else:
                    with tasks_lock:
                        tasks[download_id]["status"] = "error"
                        tasks[download_id]["error"] = "File not found after download"
                        tasks[download_id]["completed_at"] = time.time()
        except Exception as e:
            with tasks_lock:
                tasks[download_id]["status"] = "error"
                tasks[download_id]["error"] = str(e)
                tasks[download_id]["completed_at"] = time.time()

    threading.Thread(target=run_download, daemon=True).start()

    return {"status": "ok", "download_id": download_id, "title": tasks[download_id]["title"]}

# --- Endpoint: Check Progress ---
@app.get("/progress/{download_id}")
async def progress(download_id: str):
    with tasks_lock:
        t = tasks.get(download_id)
        if not t:
            return JSONResponse(status_code=404, content={"status": "error", "message": "Download not found"})
        return {
            "status": t["status"],
            "progress": float(t["progress"]),
            "title": t.get("title"),
            "error": t.get("error")
        }

# --- Endpoint: Cancel Download ---
@app.post("/cancel/{download_id}")
async def cancel(download_id: str):
    with tasks_lock:
        t = tasks.get(download_id)
        if not t:
            return JSONResponse(status_code=404, content={"status": "error", "message": "Download not found"})
        t["cancel"] = True
        t["status"] = "cancelled"
        t["completed_at"] = time.time()
    return {"status": "ok", "message": "Download cancelled"}

# --- Endpoint: Serve File ---
@app.get("/file/{download_id}")
async def download_file(download_id: str):
    with tasks_lock:
        t = tasks.get(download_id)
        if not t:
            return JSONResponse(status_code=404, content={"status": "error", "message": "Download not found"})
        if t["status"] != "done" or not t.get("filepath"):
            return JSONResponse(status_code=400, content={"status": "error", "message": "File not ready"})
        filepath = t["filepath"]
    if not os.path.exists(filepath):
        return JSONResponse(status_code=404, content={"status": "error", "message": "File missing on server"})
    filename = os.path.basename(filepath)
    return FileResponse(filepath, media_type="application/octet-stream", filename=filename)

# --- Background Cleanup Thread ---
def cleanup_worker():
    while True:
        try:
            now = time.time()
            with tasks_lock:
                for did, t in list(tasks.items()):
                    completed_at = t.get("completed_at")
                    filepath = t.get("filepath")
                    if completed_at and (now - completed_at) > FILE_RETENTION_SECONDS:
                        if filepath and os.path.exists(filepath):
                            try:
                                os.remove(filepath)
                            except Exception:
                                pass
                        tasks.pop(did, None)
            # Remove orphan files
            for f in DOWNLOADS_DIR.glob("*.*"):
                try:
                    if (now - f.stat().st_mtime) > FILE_RETENTION_SECONDS:
                        f.unlink(missing_ok=True)
                except Exception:
                    pass
        except Exception:
            pass
        time.sleep(60)

threading.Thread(target=cleanup_worker, daemon=True).start()
