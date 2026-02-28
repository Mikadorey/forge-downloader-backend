# main.py
import os
import uuid
import re
import shutil
import threading
import subprocess
from typing import Optional, Dict, Any
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

# CONFIG
DOWNLOADS_DIR = "downloads"
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

# FastAPI app
app = FastAPI(title="Forge Downloader API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Tasks: maps download_id -> info dict
# { download_id: {"proc": Popen, "progress": "0", "file": path or None, "status":"running|done|error|canceled", "meta": {...}} }
tasks: Dict[str, Dict[str, Any]] = {}

# Request model
class DownloadRequest(BaseModel):
    url: str
    type: Optional[str] = "video"  # "video" or "audio"
    quality: Optional[str] = "best"  # yt-dlp format selector

# Utility to sanitize filename
def _make_output_path(download_id: str, ext_placeholder="%(ext)s"):
    return os.path.join(DOWNLOADS_DIR, f"{download_id}.{ext_placeholder}")

# Endpoint: get video info (title, thumbnail, available formats)
@app.post("/get_info")
async def get_info(req: DownloadRequest):
    import yt_dlp
    url = req.url
    try:
        ydl_opts = {"skip_download": True, "quiet": True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            # Prepare a compact formats list
            formats = []
            for f in info.get("formats", []):
                # include useful fields and skip duplicates
                formats.append({
                    "format_id": f.get("format_id"),
                    "ext": f.get("ext"),
                    "tbr": f.get("tbr"),
                    "resolution": f.get("format_note") or f.get("resolution") or f.get("height"),
                    "fps": f.get("fps"),
                    "filesize": f.get("filesize"),
                })
            return {
                "title": info.get("title"),
                "thumbnail": info.get("thumbnail"),
                "uploader": info.get("uploader"),
                "duration": info.get("duration"),
                "formats": formats
            }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# Endpoint: start download
@app.post("/download")
async def start_download(req: DownloadRequest):
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    download_id = str(uuid.uuid4())
    out_template = _make_output_path(download_id)
    # Build yt-dlp command
    cmd = ["yt-dlp", url, "-f", req.quality, "-o", out_template, "--no-playlist"]

    if req.type == "audio":
        cmd += ["-x", "--audio-format", "mp3", "--audio-quality", "0"]

    # Use --no-progress to simplify parsing? We'll parse stderr for progress lines yt-dlp prints.
    # Start subprocess
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail="yt-dlp not found on the server. Install yt-dlp in environment.")

    tasks[download_id] = {
        "proc": proc,
        "progress": "0",
        "file": None,
        "status": "running",
        "meta": {"url": url, "type": req.type, "quality": req.quality}
    }

    # Monitor thread
    def monitor_process(did: str, p: subprocess.Popen, req_type: str):
        # Parse stderr lines for progress
        prog = "0"
        try:
            # Merge both streams consumption; yt-dlp outputs progress to stderr
            for line in p.stderr:
                line = line.strip()
                # Example yt-dlp progress lines include: "[download]  12.3% of 10.00MiB at 123.45KiB/s ETA 00:45"
                if "%" in line and "ETA" in line:
                    m = re.search(r'(\d{1,3}\.\d|\d{1,3})\%', line)
                    if m:
                        prog = m.group(1)
                        try:
                            tasks[did]["progress"] = str(float(prog))
                        except:
                            tasks[did]["progress"] = prog
                # Catch final lines indicating complete
            p.wait()
            # If process exit code != 0 -> error
            if p.returncode != 0:
                tasks[did]["status"] = "error"
                tasks[did]["progress"] = "0"
                # Attempt to capture last stderr
                tasks[did]["error"] = f"yt-dlp exited with code {p.returncode}"
            else:
                # Determine file path (choose ext)
                ext = "mp4" if req_type == "video" else "mp3"
                file_path = _make_output_path(did, ext_placeholder=ext)
                # If file was saved with a different extension (e.g., webm) try to find the produced file
                if not os.path.exists(file_path):
                    # search downloads dir for prefix
                    base = os.path.join(DOWNLOADS_DIR, did + ".")
                    found = None
                    for fname in os.listdir(DOWNLOADS_DIR):
                        if fname.startswith(did + "."):
                            found = os.path.join(DOWNLOADS_DIR, fname)
                            break
                    if found:
                        file_path = found
                tasks[did]["file"] = file_path if os.path.exists(file_path) else None
                tasks[did]["status"] = "done" if tasks[did]["file"] else "error"
                tasks[did]["progress"] = "100"
        except Exception as e:
            tasks[did]["status"] = "error"
            tasks[did]["error"] = str(e)

    threading.Thread(target=monitor_process, args=(download_id, proc, req.type), daemon=True).start()
    return {"download_id": download_id}

# Endpoint: poll progress
@app.get("/progress/{download_id}")
async def progress(download_id: str):
    task = tasks.get(download_id)
    if not task:
        raise HTTPException(status_code=404, detail="Download ID not found")
    return {
        "progress": task.get("progress", "0"),
        "status": task.get("status", "unknown"),
        "file": bool(task.get("file"))
    }

# Endpoint: cancel
@app.post("/cancel/{download_id}")
async def cancel(download_id: str):
    task = tasks.get(download_id)
    if not task:
        raise HTTPException(status_code=404, detail="Download not found")
    proc = task.get("proc")
    try:
        if proc and proc.poll() is None:
            proc.terminate()
            proc.wait(timeout=5)
        task["status"] = "canceled"
        # cleanup partial files
        prefix = os.path.join(DOWNLOADS_DIR, download_id + ".")
        for f in os.listdir(DOWNLOADS_DIR):
            if f.startswith(download_id + "."):
                try:
                    os.remove(os.path.join(DOWNLOADS_DIR, f))
                except:
                    pass
        tasks.pop(download_id, None)
        return {"status": "canceled"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Endpoint: download file (serves file when ready)
@app.get("/file/{download_id}")
async def get_file(download_id: str):
    task = tasks.get(download_id)
    if not task:
        raise HTTPException(status_code=404, detail="Download not found")
    if task.get("status") != "done" or not task.get("file"):
        raise HTTPException(status_code=404, detail="File not ready")
    file_path = task["file"]
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File missing on server")
    # Use FileResponse so browser will download
    filename = os.path.basename(file_path)
    return FileResponse(path=file_path, filename=filename, media_type='application/octet-stream')

# Health endpoint
@app.get("/health")
async def health():
    return {"status": "ok"}

# Optional cleanup endpoint (admin)
@app.post("/cleanup_all")
async def cleanup_all():
    # WARNING: use carefully in production
    removed = 0
    for f in os.listdir(DOWNLOADS_DIR):
        try:
            os.remove(os.path.join(DOWNLOADS_DIR, f))
            removed += 1
        except:
            pass
    tasks.clear()
    return {"removed": removed}
