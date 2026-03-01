// ================================
// Forge Downloader - Production Script
// AdSense-Safe + Production Ready
// ================================

// ===== CONFIG =====
const API_BASE = "https://www.forgedownloader.net/api"; // 🔁 CHANGE if your API path differs
const MAX_PROGRESS_RETRIES = 5;

// ===== ELEMENTS =====
const urlField = document.getElementById('urlField');
const pasteBtn = document.getElementById('pasteBtn');
const previewBtn = document.getElementById('previewBtn');
const previewSection = document.getElementById('previewSection');
const thumbnail = document.getElementById('thumbnail');
const videoTitle = document.getElementById('videoTitle');
const downloadVideo = document.getElementById('downloadVideo');
const downloadAudio = document.getElementById('downloadAudio');
const cancelBtn = document.getElementById('cancelBtn');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const platformsEl = document.getElementById('platforms');

const adModal = document.getElementById('adModal');
const closeAd = document.getElementById('closeAd');
const adContinueBtn = document.getElementById('adContinueBtn');

let currentPlatform = 'youtube';
let currentDownloadId = null;
let progressInterval = null;
let progressRetryCount = 0;
let pendingAction = null;

// ===== ERROR DISPLAY =====
function showError(message) {
  let errorEl = document.getElementById("errorMsg");
  if (!errorEl) {
    errorEl = document.createElement("p");
    errorEl.id = "errorMsg";
    errorEl.style.color = "#ff6961";
    errorEl.style.textAlign = "center";
    errorEl.style.marginTop = "10px";
    document.querySelector(".container")?.appendChild(errorEl);
  }
  errorEl.textContent = message;
  setTimeout(() => errorEl.textContent = "", 5000);
}

// ===== URL VALIDATION =====
function isValidURL(str) {
  try {
    const url = new URL(str);
    return ["http:", "https:"].includes(url.protocol);
  } catch (_) {
    return false;
  }
}

// ===== PLATFORM SWITCH =====
if (platformsEl) {
  platformsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.platform-btn');
    if (!btn) return;

    document.querySelectorAll('.platform-btn')
      .forEach(b => b.classList.remove('active'));

    btn.classList.add('active');
    currentPlatform = btn.dataset.platform || 'youtube';

    const placeholders = {
      youtube: 'Paste YouTube URL here...',
      tiktok: 'Paste TikTok URL here...',
      instagram: 'Paste Instagram URL here...',
      facebook: 'Paste Facebook URL here...',
      x: 'Paste X (Twitter) URL here...',
      pinterest: 'Paste Pinterest URL here...'
    };

    urlField.placeholder = placeholders[currentPlatform] || 'Paste link here...';
  });
}

// ===== CLIPBOARD PASTE =====
pasteBtn?.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    urlField.value = text || '';
    pendingAction = { action: 'preview' };
    showAdModal();
  } catch {
    showError("Unable to access clipboard.");
  }
});

// ===== PREVIEW =====
previewBtn?.addEventListener('click', async () => {
  await fetchMediaInfo();
});

urlField?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') fetchMediaInfo();
});

async function fetchMediaInfo() {
  const url = urlField.value.trim();
  if (!url || !isValidURL(url)) {
    showError("Please enter a valid URL.");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/get_info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, platform: currentPlatform })
    });

    if (!res.ok) throw new Error(await res.text());

    const data = await res.json();

    thumbnail.src = data.thumbnail || '';
    videoTitle.textContent = data.title || 'Preview';
    previewSection.style.display = 'flex';

  } catch (err) {
    console.error(err);
    showError("Failed to fetch media info.");
  }
}

// ===== DOWNLOAD FLOW =====
downloadVideo?.addEventListener('click', () => {
  pendingAction = { action: 'download', type: 'video' };
  showAdModal();
});

downloadAudio?.addEventListener('click', () => {
  pendingAction = { action: 'download', type: 'audio' };
  showAdModal();
});

async function startDownload(type) {
  if (currentDownloadId) return;

  const url = urlField.value.trim();
  if (!url || !isValidURL(url)) {
    showError("Please enter a valid URL.");
    return;
  }

  const quality = document.getElementById('qualitySelect')?.value || 'best';

  try {
    const res = await fetch(`${API_BASE}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type, quality, platform: currentPlatform })
    });

    if (!res.ok) throw new Error(await res.text());

    const data = await res.json();
    currentDownloadId = data.download_id;

    progressContainer.style.display = 'flex';
    progressBar.value = 0;
    progressText.textContent = '0%';

    progressRetryCount = 0;

    progressInterval = setInterval(checkProgress, 1200);

  } catch (err) {
    console.error(err);
    showError("Failed to start download.");
  }
}

async function checkProgress() {
  if (!currentDownloadId) return;

  try {
    const res = await fetch(`${API_BASE}/progress/${currentDownloadId}`);
    if (!res.ok) throw new Error();

    const data = await res.json();
    const pct = parseFloat(data.progress || 0);

    progressBar.value = pct;
    progressText.textContent = `${Math.round(pct)}%`;

    if (data.status === 'done' || pct >= 100) {
      clearInterval(progressInterval);
      await downloadFile();
    }

  } catch {
    progressRetryCount++;
    if (progressRetryCount >= MAX_PROGRESS_RETRIES) {
      clearInterval(progressInterval);
      showError("Download failed. Please try again.");
      progressContainer.style.display = 'none';
      currentDownloadId = null;
    }
  }
}

async function downloadFile() {
  try {
    const res = await fetch(`${API_BASE}/file/${currentDownloadId}`);
    if (!res.ok) throw new Error();

    const blob = await res.blob();
    const urlBlob = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = urlBlob;
    a.download = `download_${currentDownloadId}`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(urlBlob);

    progressText.textContent = "Download complete";
    setTimeout(() => progressContainer.style.display = 'none', 2500);
    currentDownloadId = null;

  } catch {
    showError("Failed to retrieve file.");
  }
}
gtag('event', 'download_click', {
  event_category: 'engagement',
  event_label: 'video_download'
});

// ===== CANCEL =====
cancelBtn?.addEventListener('click', async () => {
  if (!currentDownloadId) return;

  try {
    await fetch(`${API_BASE}/cancel/${currentDownloadId}`, { method: 'POST' });
  } catch {}

  clearInterval(progressInterval);
  progressContainer.style.display = 'none';
  currentDownloadId = null;
});

// ===== AD MODAL (AdSense-Safe) =====
function showAdModal() {
  if (!adModal) return;

  adModal.style.display = 'flex';
  adModal.setAttribute('aria-hidden', 'false');

  if (adContinueBtn) {
    adContinueBtn.disabled = false;
    adContinueBtn.textContent = "Continue";
  }

  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch {}
}

function hideAdModal() {
  if (!adModal) return;
  adModal.style.display = 'none';
  adModal.setAttribute('aria-hidden', 'true');
}

closeAd?.addEventListener('click', () => {
  hideAdModal();
  pendingAction = null;
});

adContinueBtn?.addEventListener('click', async () => {
  hideAdModal();

  if (!pendingAction) return;

  if (pendingAction.action === 'preview') {
    await fetchMediaInfo();
  } else if (pendingAction.action === 'download') {
    await startDownload(pendingAction.type);
  }

  pendingAction = null;
});

// Optional: detect manual paste
urlField?.addEventListener('paste', () => {
  setTimeout(() => {
    if (urlField.value.trim()) {
      pendingAction = { action: 'preview' };
      showAdModal();
    }
  }, 50);
});
