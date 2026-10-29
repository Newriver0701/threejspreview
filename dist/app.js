const SAMPLE_CODE = `// THREE は自動で読み込まれています。
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c0d0d);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
camera.position.z = 4;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const geometry = new THREE.IcosahedronGeometry(1.15, 2);
const material = new THREE.MeshNormalMaterial({ flatShading: true });
const object = new THREE.Mesh(geometry, material);
scene.add(object);

// プレビューとMP4書き出しの両方から、秒単位で呼ばれます。
globalThis.renderAt = async (timeSeconds) => {
  object.rotation.x = timeSeconds * 0.7;
  object.rotation.y = timeSeconds * 1.1;
  renderer.render(scene, camera);
};

// プレビューサイズ・書き出し解像度の変更時に呼ばれます。
globalThis.setRenderSize = async (width, height) => {
  renderer.setPixelRatio(1);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
};`;

const editor = document.querySelector("#code-editor");
const runButton = document.querySelector("#run-button");
const resetButton = document.querySelector("#reset-button");
const frame = document.querySelector("#preview-frame");
const emptyState = document.querySelector("#empty-state");
const status = document.querySelector("#status");
const errorPanel = document.querySelector("#error-panel");
const errorOutput = document.querySelector("#error-output");
const clearErrorButton = document.querySelector("#clear-error");
const previewResolutionSelect = document.querySelector("#preview-resolution");
const resolutionSelect = document.querySelector("#export-resolution");
const durationModeSelect = document.querySelector("#export-duration-mode");
const durationManualField = document.querySelector("#export-duration-manual-field");
const durationAutoNote = document.querySelector("#export-duration-auto-note");
const durationInput = document.querySelector("#export-duration");
const qualitySelect = document.querySelector("#export-quality");
const exportButton = document.querySelector("#export-button");
const exportLabel = document.querySelector("#export-label");
const exportProgress = document.querySelector("#export-progress");
const exportProgressBar = document.querySelector("#export-progress-bar");
const exportProgressText = document.querySelector("#export-progress-text");

let runId = 0;
let exporting = false;
let previewReady = false;
let resizingPreview = false;
let ffmpegInstance = null;
let ffmpegFetchFile = null;
let frameRequestId = 0;
let detectedDuration = null;
const pendingFrameRequests = new Map();

editor.value = localStorage.getItem("three-preview-draft") || SAMPLE_CODE;
previewResolutionSelect.value = localStorage.getItem("three-preview-resolution") || "720x1280";
resolutionSelect.value = localStorage.getItem("three-export-resolution") || "720x1280@30";
durationModeSelect.value = localStorage.getItem("three-export-duration-mode") === "auto" ? "auto" : "manual";

function updateDurationControls() {
  const automatic = durationModeSelect.value === "auto";
  durationManualField.hidden = automatic;
  durationAutoNote.hidden = !automatic;
  if (automatic) {
    durationAutoNote.textContent = detectedDuration === null
      ? "終了時刻を取得できません。JSに globalThis.exportDurationSeconds を指定してください。"
      : detectedDuration > 60
        ? `JSの終了時刻: ${detectedDuration}秒（書き出し上限は60秒です）`
        : `JSの終了時刻: ${detectedDuration}秒`;
  }
}

updateDurationControls();

function parseSize(value) {
  const [width, height] = value.split("x").map(Number);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("解像度の設定が正しくありません。");
  }
  return { width, height };
}

function getPreviewSize() {
  return parseSize(previewResolutionSelect.value);
}

function getSelectedExportFrameRate() {
  const fps = Number(resolutionSelect.value.split("@")[1]);
  return fps === 24 ? 24 : 30;
}

function updatePreviewViewport() {
  const { width, height } = getPreviewSize();
  frame.parentElement.style.setProperty("--preview-ratio", String(width / height));
  frame.setAttribute("aria-label", `プレビュー ${width} × ${height}`);
}

updatePreviewViewport();

function setStatus(kind, label) {
  status.className = `status ${kind || ""}`.trim();
  status.innerHTML = `<i></i>${label}`;
}

function showError(message) {
  errorOutput.textContent = message || "不明なエラーが発生しました。";
  errorPanel.hidden = false;
  setStatus("error", "エラー");
}

function clearError() {
  errorPanel.hidden = true;
  errorOutput.textContent = "";
}

function postToPreview(type, payload = {}) {
  frame.contentWindow?.postMessage({ source: "three-preview-host", runId, type, ...payload }, "*");
}

function runCode() {
  if (exporting) return;
  clearError();
  runId += 1;
  previewReady = false;
  detectedDuration = null;
  updateDurationControls();
  updateRuntimeCandidates([]);
  persistDraft();
  exportButton.disabled = true;
  previewResolutionSelect.disabled = true;
  emptyState.hidden = true;
  setStatus("", "読み込み中");

  const currentRunId = runId;
  const runtimeUrl = new URL("./preview.html", location.href);
  runtimeUrl.searchParams.set("run", String(currentRunId));
  frame.src = runtimeUrl.href;

  const sendInitialization = () => {
    if (currentRunId === runId) {
      frame.dataset.initSent = String(Number(frame.dataset.initSent || 0) + 1);
      postToPreview("initialize", { code: editor.value, ...getPreviewSize(), fps: getSelectedExportFrameRate(), overrides: getImageOverrides() });
    }
  };
  setTimeout(sendInitialization, 250);
  setTimeout(sendInitialization, 1_000);
  setTimeout(sendInitialization, 3_000);
}

function waitForPreview(successType, errorType, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("プレビューからの応答がタイムアウトしました。"));
    }, timeoutMs);

    function onMessage(event) {
      const data = event.data;
      if (event.source !== frame.contentWindow || data?.source !== "three-preview" || data.runId !== runId) return;
      if (data.type !== successType && data.type !== errorType) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (data.type === successType) resolve(data);
      else reject(new Error(data.message));
    }

    window.addEventListener("message", onMessage);
  });
}

function requestPngFrame(timeSeconds) {
  return new Promise((resolve, reject) => {
    const requestId = ++frameRequestId;
    const timer = setTimeout(() => {
      pendingFrameRequests.delete(requestId);
      reject(new Error("フレーム描画がタイムアウトしました。"));
    }, 30_000);

    pendingFrameRequests.set(requestId, {
      resolve(frameData) {
        clearTimeout(timer);
        resolve(frameData);
      },
      reject(error) {
        clearTimeout(timer);
        reject(error);
      }
    });

    postToPreview("export-frame", { requestId, timeSeconds });
  });
}

function getExportSettings() {
  const [size, fpsText] = resolutionSelect.value.split("@");
  const { width, height } = parseSize(size);
  let duration;
  if (durationModeSelect.value === "auto") {
    if (detectedDuration === null) {
      throw new Error("JSの終了時刻を取得できません。globalThis.exportDurationSeconds = 秒数 を指定するか、手動で秒数を入力してください。");
    }
    if (detectedDuration > 60) throw new Error("JSの終了時刻が60秒を超えています。現在の書き出し上限は60秒です。");
    duration = detectedDuration;
  } else {
    duration = Math.max(1, Math.min(60, Number(durationInput.value) || 10));
    durationInput.value = String(duration);
  }
  const quality = {
    high: { crf: "20", preset: "veryfast" },
    standard: { crf: "24", preset: "veryfast" },
    fast: { crf: "28", preset: "ultrafast" }
  }[qualitySelect.value];

  return { width, height, fps: Number(fpsText), duration, ...quality };
}

async function resizePreview() {
  updatePreviewViewport();
  localStorage.setItem("three-preview-resolution", previewResolutionSelect.value);
  if (!previewReady || exporting || resizingPreview) return;

  resizingPreview = true;
  previewResolutionSelect.disabled = true;
  clearError();
  setStatus("", "サイズ変更中");
  try {
    const resized = waitForPreview("preview-resized", "preview-resize-error");
    postToPreview("preview-resize", getPreviewSize());
    await resized;
    setStatus("running", "実行中");
  } catch (error) {
    showError(error.message);
  } finally {
    resizingPreview = false;
    previewResolutionSelect.disabled = false;
  }
}

function setExportProgress(value, message) {
  exportProgress.hidden = false;
  exportProgressBar.value = Math.max(0, Math.min(1, value));
  exportProgressText.textContent = message;
}

async function getFfmpeg() {
  if (ffmpegInstance) return { ffmpeg: ffmpegInstance, fetchFile: ffmpegFetchFile };
  if (!crossOriginIsolated) {
    throw new Error("FFmpeg.wasmを実行できません。付属のNodeサーバーから開き、COOP/COEPヘッダーを有効にしてください。");
  }

  setStatus("", "FFmpegを読み込み中");
  const [{ FFmpeg }, { fetchFile }] = await Promise.all([
    import("/vendor/@ffmpeg/ffmpeg/dist/esm/index.js"),
    import("/vendor/@ffmpeg/util/dist/esm/index.js")
  ]);

  const ffmpeg = new FFmpeg();
  ffmpeg.on("progress", ({ progress }) => {
    if (!exporting || !Number.isFinite(progress)) return;
    exportProgressBar.value = 0.8 + Math.max(0, Math.min(1, progress)) * 0.2;
    exportProgressText.textContent = `H.264 MP4へ変換中… ${Math.round(progress * 100)}%`;
  });

  await ffmpeg.load({
    workerURL: "/vendor/@ffmpeg/ffmpeg/dist/esm/worker.js",
    coreURL: "/vendor/@ffmpeg/core/dist/esm/ffmpeg-core.js",
    wasmURL: "/vendor/@ffmpeg/core/dist/esm/ffmpeg-core.wasm"
  });

  ffmpegInstance = ffmpeg;
  ffmpegFetchFile = fetchFile;
  return { ffmpeg, fetchFile };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function byteArrayContainsAscii(bytes, text) {
  const needle = Array.from(text, (character) => character.charCodeAt(0));
  for (let offset = 0; offset <= bytes.length - needle.length; offset += 1) {
    if (needle.every((value, index) => bytes[offset + index] === value)) return true;
  }
  return false;
}

async function runMp4Export() {
  if (exporting) return;
  exporting = true;
  clearError();
  exportButton.disabled = true;
  runButton.disabled = true;
  resetButton.disabled = true;
  previewResolutionSelect.disabled = true;
  resolutionSelect.disabled = true;
  durationModeSelect.disabled = true;
  durationInput.disabled = true;
  exportLabel.textContent = "書き出し中…";

  const writtenFrames = [];
  let previewExportStarted = false;

  try {
    const settings = getExportSettings();
    const frameCount = Math.round(settings.duration * settings.fps);
    const { ffmpeg, fetchFile } = await getFfmpeg();

    setExportProgress(0, "書き出し解像度を準備中…");
    const readyPromise = waitForPreview("export-ready", "export-error");
    postToPreview("export-begin", { width: settings.width, height: settings.height });
    await readyPromise;
    previewExportStarted = true;

    for (let index = 0; index < frameCount; index += 1) {
      const frameData = await requestPngFrame(index / settings.fps);
      if (frameData.width !== settings.width || frameData.height !== settings.height) {
        throw new Error(`PNGの解像度が一致しません（${frameData.width}×${frameData.height}）。`);
      }
      const filename = `frame_${String(index + 1).padStart(6, "0")}.png`;
      await ffmpeg.writeFile(filename, await fetchFile(frameData.blob));
      writtenFrames.push(filename);
      setExportProgress(((index + 1) / frameCount) * 0.8, `PNG生成 ${index + 1} / ${frameCount}`);
    }

    setExportProgress(0.8, "H.264 MP4へ変換中…");
    const exitCode = await ffmpeg.exec([
      "-framerate", String(settings.fps),
      "-start_number", "1",
      "-i", "frame_%06d.png",
      "-c:v", "libx264",
      "-preset", settings.preset,
      "-crf", settings.crf,
      "-pix_fmt", "yuv420p",
      "-movflags", "faststart",
      "output.mp4"
    ]);
    if (exitCode !== 0) throw new Error(`FFmpegの変換に失敗しました（終了コード: ${exitCode}）。`);

    const data = await ffmpeg.readFile("output.mp4");
    const blob = new Blob([data], { type: "video/mp4" });
    globalThis.__THREE_PREVIEW_LAST_EXPORT__ = {
      bytes: data.byteLength,
      hasFtyp: byteArrayContainsAscii(data, "ftyp"),
      hasH264Avc1: byteArrayContainsAscii(data, "avc1")
    };
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadBlob(blob, `three-preview-${timestamp}.mp4`);
    setExportProgress(1, "MP4を保存しました");
    setStatus("running", "MP4を保存しました");
  } catch (error) {
    showError(error.stack || error.message);
  } finally {
    if (previewExportStarted) {
      try {
        const restored = waitForPreview("export-ended", "export-restore-error");
        postToPreview("export-end");
        await restored;
      } catch (error) {
        showError(error.message);
      }
    }
    if (ffmpegInstance) {
      const frameCleanup = await Promise.allSettled(writtenFrames.map((filename) => ffmpegInstance.deleteFile(filename)));
      let outputDeleted = true;
      await ffmpegInstance.deleteFile("output.mp4").catch(() => { outputDeleted = false; });
      globalThis.__THREE_PREVIEW_LAST_CLEANUP__ = {
        frames: writtenFrames.length,
        failedFrameDeletes: frameCleanup.filter((result) => result.status === "rejected").length,
        outputDeleted
      };
    }
    exporting = false;
    exportButton.disabled = false;
    runButton.disabled = false;
    resetButton.disabled = false;
    previewResolutionSelect.disabled = false;
    resolutionSelect.disabled = false;
    durationModeSelect.disabled = false;
    durationInput.disabled = false;
    exportLabel.textContent = "MP4を書き出す";
  }
}

window.addEventListener("message", (event) => {
  const data = event.data;
  if (event.source !== frame.contentWindow || data?.source !== "three-preview") return;

  if (data.type === "runtime-ready") {
    postToPreview("initialize", { code: editor.value, ...getPreviewSize(), fps: getSelectedExportFrameRate(), overrides: getImageOverrides() });
    return;
  }

  if (data.runId !== runId) return;

  if (data.type === "ready") {
    detectedDuration = Number.isFinite(data.duration) && data.duration >= 1 ? data.duration : null;
    updateDurationControls();
    previewReady = true;
    previewResolutionSelect.disabled = false;
    setStatus("running", "実行中");
    exportButton.disabled = false;
  }

  if (data.type === "texture-candidates") updateRuntimeCandidates(data.candidates);

  if (data.type === "error" || data.type === "console-error") {
    previewResolutionSelect.disabled = false;
    showError(data.message);
  }

  if (data.type === "export-frame" || data.type === "export-frame-error") {
    const pending = pendingFrameRequests.get(data.requestId);
    if (!pending) return;
    pendingFrameRequests.delete(data.requestId);
    if (data.type === "export-frame") pending.resolve({ blob: data.blob, width: data.width, height: data.height });
    else pending.reject(new Error(data.message));
  }
});

runButton.addEventListener("click", runCode);
resetButton.addEventListener("click", () => {
  editor.value = SAMPLE_CODE;
  handleEditorChange();
  editor.focus();
});
clearErrorButton.addEventListener("click", clearError);
exportButton.addEventListener("click", runMp4Export);
previewResolutionSelect.addEventListener("change", resizePreview);
resolutionSelect.addEventListener("change", () => {
  localStorage.setItem("three-export-resolution", resolutionSelect.value);
  if (previewReady && !exporting) {
    postToPreview("preview-fps", { fps: getSelectedExportFrameRate() });
  }
});
durationModeSelect.addEventListener("change", () => {
  localStorage.setItem("three-export-duration-mode", durationModeSelect.value);
  updateDurationControls();
});

editor.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    runCode();
  }
  if (event.key === "Tab") {
    event.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText("  ", start, end, "end");
  }
});
