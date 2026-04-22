// ═══════════════════════════════════════════
//  GIF Recording System
// ═══════════════════════════════════════════

const gifModal     = document.getElementById('gif-modal');
const gifOpenBtn   = document.getElementById('gif-open-btn');
const gifCloseBtn  = document.getElementById('gif-close-btn');
const gifRecordBtn = document.getElementById('gif-record-btn');
const gifDurSlider = document.getElementById('gif-dur');
const gifFpsSlider = document.getElementById('gif-fps');
const gifScaleSlider = document.getElementById('gif-scale');
const gifDurVal    = document.getElementById('gif-dur-val');
const gifFpsVal    = document.getElementById('gif-fps-val');
const gifScaleVal  = document.getElementById('gif-scale-val');
const gifProgress  = document.getElementById('gif-progress');
const gifProgText  = document.getElementById('gif-progress-text');
const gifBarFill   = document.getElementById('gif-bar-fill');
const gifPreview   = document.getElementById('gif-preview-area');
const gifImg       = document.getElementById('gif-preview-img');
const gifSizeInfo  = document.getElementById('gif-size-info');
const gifDownBtn   = document.getElementById('gif-download-btn');
const gifShareBtn  = document.getElementById('gif-share-btn');

let gifBlob = null;
let isRecording = false;

// Modal open/close
gifOpenBtn.addEventListener('click', () => gifModal.classList.add('open'));
gifCloseBtn.addEventListener('click', () => gifModal.classList.remove('open'));
gifModal.addEventListener('click', e => { if (e.target === gifModal) gifModal.classList.remove('open'); });

// Slider value display
gifDurSlider.addEventListener('input', () => gifDurVal.textContent = parseFloat(gifDurSlider.value).toFixed(1) + 's');
gifFpsSlider.addEventListener('input', () => gifFpsVal.textContent = gifFpsSlider.value);
gifScaleSlider.addEventListener('input', () => gifScaleVal.textContent = parseFloat(gifScaleSlider.value) + 'x');

// ── GIF Encoder (self-contained, no external deps) ──
// Minimal GIF89a encoder with LZW compression
function encodeGIF(frames, width, height, delay) {
  const buf = [];
  const push = (...bytes) => bytes.forEach(b => buf.push(b & 0xFF));
  const pushStr = s => { for (let i = 0; i < s.length; i++) buf.push(s.charCodeAt(i)); };
  const pushLE = (v, n) => { for (let i = 0; i < n; i++) { buf.push(v & 0xFF); v >>= 8; } };

  // Build global color table from all frames (median cut to 256 colors)
  const colorMap = new Map();
  const allPixels = [];
  for (const frame of frames) {
    for (let i = 0; i < frame.length; i += 4) {
      const r = frame[i], g = frame[i+1], b = frame[i+2];
      const key = (r << 16) | (g << 8) | b;
      if (!colorMap.has(key)) colorMap.set(key, 0);
      colorMap.set(key, colorMap.get(key) + 1);
      allPixels.push(key);
    }
  }

  // Quantize to 256 colors using popularity
  let palette;
  if (colorMap.size <= 256) {
    palette = Array.from(colorMap.keys());
  } else {
    palette = Array.from(colorMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 256)
      .map(e => e[0]);
  }
  while (palette.length < 256) palette.push(0);

  // Build lookup for nearest color
  const palR = palette.map(c => (c >> 16) & 0xFF);
  const palG = palette.map(c => (c >> 8) & 0xFF);
  const palB = palette.map(c => c & 0xFF);

  function nearest(r, g, b) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < 256; i++) {
      const dr = r - palR[i], dg = g - palG[i], db = b - palB[i];
      const d = dr*dr + dg*dg + db*db;
      if (d < bestD) { bestD = d; best = i; if (d === 0) break; }
    }
    return best;
  }

  // Build nearest-color cache
  const nearCache = new Map();
  function nearestCached(r, g, b) {
    const key = (r << 16) | (g << 8) | b;
    if (nearCache.has(key)) return nearCache.get(key);
    const idx = nearest(r, g, b);
    nearCache.set(key, idx);
    return idx;
  }

  // Header
  pushStr('GIF89a');
  pushLE(width, 2);
  pushLE(height, 2);
  push(0xF7, 0, 0); // GCT flag, 256 colors (2^(7+1)), bg=0, aspect=0

  // Global Color Table
  for (let i = 0; i < 256; i++) {
    push(palR[i], palG[i], palB[i]);
  }

  // Netscape extension for looping
  push(0x21, 0xFF, 0x0B);
  pushStr('NETSCAPE2.0');
  push(0x03, 0x01);
  pushLE(0, 2); // loop forever
  push(0x00);

  // Frames
  const delayCS = Math.round(delay / 10); // centiseconds
  for (const frame of frames) {
    // Graphics Control Extension
    push(0x21, 0xF9, 0x04, 0x00);
    pushLE(delayCS, 2);
    push(0x00, 0x00);

    // Image Descriptor
    push(0x2C);
    pushLE(0, 2); pushLE(0, 2);
    pushLE(width, 2); pushLE(height, 2);
    push(0x00); // no local color table

    // LZW encode
    const minCodeSize = 8;
    push(minCodeSize);

    const pixels = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const si = i * 4;
      pixels[i] = nearestCached(frame[si], frame[si+1], frame[si+2]);
    }

    // LZW compression
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let nextCode = eoiCode + 1;
    const table = new Map();
    let bitBuf = 0, bitCount = 0;
    const lzwOut = [];

    function emit(code) {
      bitBuf |= (code << bitCount);
      bitCount += codeSize;
      while (bitCount >= 8) {
        lzwOut.push(bitBuf & 0xFF);
        bitBuf >>= 8;
        bitCount -= 8;
      }
    }

    function resetTable() {
      table.clear();
      for (let i = 0; i < clearCode; i++) table.set(String(i), i);
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
    }

    emit(clearCode);
    resetTable();

    let cur = String(pixels[0]);
    for (let i = 1; i < pixels.length; i++) {
      const next = String(pixels[i]);
      const combined = cur + ',' + next;
      if (table.has(combined)) {
        cur = combined;
      } else {
        emit(table.get(cur));
        if (nextCode < 4096) {
          table.set(combined, nextCode++);
          if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
        } else {
          emit(clearCode);
          resetTable();
        }
        cur = next;
      }
    }
    emit(table.get(cur));
    emit(eoiCode);
    if (bitCount > 0) lzwOut.push(bitBuf & 0xFF);

    // Write sub-blocks
    let pos = 0;
    while (pos < lzwOut.length) {
      const chunk = Math.min(255, lzwOut.length - pos);
      push(chunk);
      for (let i = 0; i < chunk; i++) buf.push(lzwOut[pos++]);
    }
    push(0x00); // block terminator
  }

  // Trailer
  push(0x3B);

  return new Uint8Array(buf);
}

// ── Recording logic ──
gifRecordBtn.addEventListener('click', async () => {
  if (isRecording) return;
  isRecording = true;
  gifRecordBtn.classList.add('recording');
  gifRecordBtn.textContent = '⏺ Recording...';
  gifPreview.style.display = 'none';
  gifProgress.style.display = 'block';
  gifBarFill.style.width = '0%';

  const duration = parseFloat(gifDurSlider.value) * 1000;
  const fps = parseInt(gifFpsSlider.value);
  const scale = parseFloat(gifScaleSlider.value);
  const interval = 1000 / fps;
  const totalFrames = Math.ceil(duration / interval);

  const captureCanvas = document.createElement('canvas');
  const W = testArea.clientWidth;
  const H = testArea.clientHeight;
  const gw = Math.round(W * scale);
  const gh = Math.round(H * scale);
  captureCanvas.width = gw;
  captureCanvas.height = gh;
  const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });

  // Auto-launch confetti at start of recording
  const origCount = cfg.count;
  if (mode === 'bloom') spawnBloom(W/2, H/2);
  else if (mode === 'rain') spawnRain();
  else if (mode === 'fountain') spawnFountain();
  else burst(W/2, H/2);

  const frames = [];
  let frameCount = 0;

  await new Promise(resolve => {
    const captureFrame = () => {
      if (frameCount >= totalFrames) { resolve(); return; }

      // Draw BG + canvas content scaled down
      const bgColor = testArea.style.background || getComputedStyle(testArea).backgroundColor || '#1a1a2e';
      captureCtx.fillStyle = bgColor;
      captureCtx.fillRect(0, 0, gw, gh);
      captureCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, gw, gh);

      const imageData = captureCtx.getImageData(0, 0, gw, gh);
      frames.push(imageData.data);

      frameCount++;
      const pct = Math.round((frameCount / totalFrames) * 50);
      gifBarFill.style.width = pct + '%';
      gifProgText.textContent = `Capturing frame ${frameCount}/${totalFrames}...`;

      setTimeout(captureFrame, interval);
    };
    captureFrame();
  });

  // Encode GIF
  gifProgText.textContent = 'Encoding GIF...';
  gifBarFill.style.width = '60%';

  // Use setTimeout to let the UI update
  await new Promise(resolve => setTimeout(resolve, 50));

  const gifData = encodeGIF(frames, gw, gh, interval);

  gifBarFill.style.width = '100%';
  gifProgText.textContent = 'Done!';

  gifBlob = new Blob([gifData], { type: 'image/gif' });
  const url = URL.createObjectURL(gifBlob);
  gifImg.src = url;

  const sizeMB = (gifBlob.size / (1024 * 1024)).toFixed(2);
  const sizeKB = (gifBlob.size / 1024).toFixed(0);
  gifSizeInfo.textContent = `${gw}×${gh}px · ${totalFrames} frames · ${gifBlob.size > 1048576 ? sizeMB + ' MB' : sizeKB + ' KB'}`;

  gifPreview.style.display = 'flex';

  setTimeout(() => {
    gifProgress.style.display = 'none';
    gifRecordBtn.classList.remove('recording');
    gifRecordBtn.textContent = '⏺ Record GIF';
    isRecording = false;
  }, 600);
});

// Download
gifDownBtn.addEventListener('click', () => {
  if (!gifBlob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(gifBlob);
  a.download = 'confetti-' + Date.now() + '.gif';
  a.click();
  URL.revokeObjectURL(a.href);
});

// Share (Web Share API)
gifShareBtn.addEventListener('click', async () => {
  if (!gifBlob) return;
  const file = new File([gifBlob], 'confetti.gif', { type: 'image/gif' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Confetti GIF' });
    } catch (e) {
      if (e.name !== 'AbortError') alert('Share failed: ' + e.message);
    }
  } else {
    // Fallback: just download
    gifDownBtn.click();
  }
});
