const projectName = document.querySelector("#project-name");
const projectList = document.querySelector("#project-list");
const saveStatus = document.querySelector("#save-status");
const candidates = document.querySelector("#asset-candidates");
const saveProjectButton = document.querySelector("#save-project");
const updateProjectButton = document.querySelector("#update-project");
const duplicateProjectButton = document.querySelector("#duplicate-project");
const restoreProjectButton = document.querySelector("#restore-project");
const openProjectButton = document.querySelector("#open-project");
const deleteProjectButton = document.querySelector("#delete-project");
const DRAFT_PREFIX = "three-preview-project-draft:";
const NEW_DRAFT_KEY = `${DRAFT_PREFIX}new`;
let activeProjectId = localStorage.getItem("three-preview-project-id") || "";
let imageOverrides = JSON.parse(localStorage.getItem("three-preview-image-overrides") || "{}");
let runtimeCandidates = [];
let savedSnapshot = null;
let saving = false;

function draftKey(id = activeProjectId) { return id ? `${DRAFT_PREFIX}${id}` : NEW_DRAFT_KEY; }
function currentSnapshot() {
  return { name: projectName.value.trim() || "無題", code: editor.value, overrides: { ...imageOverrides } };
}
function snapshotText(snapshot = currentSnapshot()) { return JSON.stringify(snapshot); }
function readDraft(id = activeProjectId) {
  try { return JSON.parse(localStorage.getItem(draftKey(id)) || "null"); } catch { return null; }
}
function updateSaveButtons() {
  editor.disabled = saving;
  projectName.disabled = saving;
  saveProjectButton.disabled = saving;
  duplicateProjectButton.disabled = saving;
  updateProjectButton.disabled = saving || !activeProjectId;
  restoreProjectButton.disabled = saving || !activeProjectId;
  openProjectButton.disabled = saving;
  deleteProjectButton.disabled = saving;
}

function setEditorState(snapshot) {
  projectName.value = snapshot.name || "無題";
  editor.value = snapshot.code || "";
  imageOverrides = { ...(snapshot.overrides || {}) };
  localStorage.setItem("three-preview-image-overrides", JSON.stringify(imageOverrides));
  renderCandidates();
}

function getImageOverrides() { return imageOverrides; }

function updateRuntimeCandidates(items) {
  runtimeCandidates = Array.isArray(items) ? items : [];
  renderCandidates();
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `保存エラー ${response.status}`);
  return data;
}

function persistDraft() {
  const snapshot = currentSnapshot();
  if (activeProjectId && savedSnapshot && snapshotText(snapshot) === snapshotText(savedSnapshot)) {
    localStorage.removeItem(draftKey());
    saveStatus.textContent = "保存済み";
  } else {
    localStorage.setItem(draftKey(), snapshotText(snapshot));
    saveStatus.textContent = activeProjectId ? "未保存の変更（端末に下書き保存済み）" : "端末に下書き保存済み";
  }
  updateSaveButtons();
}

function renderCandidates() {
  candidates.replaceChildren();
  if (!runtimeCandidates.length) {
    const empty = document.createElement("p");
    empty.textContent = previewReady ? "このシーンに差し替え可能な画像はありません。" : "コードを実行すると画像候補が表示されます。";
    candidates.append(empty);
    return;
  }
  for (const item of runtimeCandidates) {
    const row = document.createElement("div");
    row.className = "asset-row";
    const img = document.createElement("img");
    img.alt = item.label;
    img.src = imageOverrides[item.key] || item.thumbnail || "";
    img.onerror = () => { img.hidden = true; };
    const label = document.createElement("span");
    label.textContent = item.label;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.setAttribute("aria-label", `${item.label}を差し替える`);
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { showError("画像は1枚5MBまでです。"); return; }
      try {
        input.disabled = true;
        const stored = await api("/api/assets", { method: "POST", headers: { "Content-Type": file.type }, body: file });
        imageOverrides[item.key] = stored.url;
        localStorage.setItem("three-preview-image-overrides", JSON.stringify(imageOverrides));
        persistDraft();
        runCode();
      } catch (error) { showError(error.message); }
      finally { input.disabled = false; }
    };
    row.append(img, label, input);
    candidates.append(row);
  }
}

function handleEditorChange() {
  persistDraft();
  renderCandidates();
}

async function refreshProjects() {
  const projects = await api("/api/projects");
  projectList.replaceChildren(new Option("保存した作品を選択", ""));
  for (const project of projects) projectList.add(new Option(project.name, project.id));
  projectList.value = activeProjectId;
}

async function openProject(id) {
  if (!id || saving) return;
  const project = await api(`/api/projects/${id}`);
  activeProjectId = id;
  localStorage.setItem("three-preview-project-id", id);
  savedSnapshot = { name: project.name, code: project.code, overrides: project.image_overrides || {} };
  setEditorState(readDraft(id) || savedSnapshot);
  persistDraft();
  runCode();
}

async function withSaving(action) {
  if (saving) return;
  saving = true;
  updateSaveButtons();
  try { await action(); }
  finally { saving = false; updateSaveButtons(); }
}

async function createProject(name = projectName.value) {
  await withSaving(async () => {
    const previousDraftKey = draftKey();
    const snapshot = { ...currentSnapshot(), name: String(name || "無題").trim().slice(0, 120) || "無題" };
    const project = await api("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: snapshotText(snapshot) });
    localStorage.removeItem(previousDraftKey);
    activeProjectId = project.id;
    localStorage.setItem("three-preview-project-id", project.id);
    savedSnapshot = snapshot;
    setEditorState(snapshot);
    persistDraft();
    saveStatus.textContent = "新しい作品として保存しました";
    await refreshProjects();
  });
}

async function updateProject() {
  if (!activeProjectId) return;
  await withSaving(async () => {
    const id = activeProjectId;
    const snapshot = currentSnapshot();
    await api(`/api/projects/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: snapshotText(snapshot) });
    savedSnapshot = snapshot;
    localStorage.removeItem(draftKey(id));
    persistDraft();
    saveStatus.textContent = "上書き保存しました";
    await refreshProjects();
  });
}

async function restoreProject() {
  if (!activeProjectId || saving) return;
  const project = await api(`/api/projects/${activeProjectId}`);
  savedSnapshot = { name: project.name, code: project.code, overrides: project.image_overrides || {} };
  localStorage.removeItem(draftKey());
  setEditorState(savedSnapshot);
  persistDraft();
  saveStatus.textContent = "保存済みの内容に戻しました";
  runCode();
}

editor.addEventListener("input", handleEditorChange);
projectName.addEventListener("input", persistDraft);
saveProjectButton.onclick = () => createProject().catch((error) => showError(error.message));
updateProjectButton.onclick = () => updateProject().catch((error) => showError(error.message));
duplicateProjectButton.onclick = () => createProject(`${projectName.value} のコピー`).catch((error) => showError(error.message));
restoreProjectButton.onclick = () => restoreProject().catch((error) => showError(error.message));
openProjectButton.onclick = () => openProject(projectList.value).catch((error) => showError(error.message));
deleteProjectButton.onclick = async () => {
  if (!projectList.value || !confirm("この作品を削除しますか？")) return;
  try {
    const id = projectList.value;
    await api(`/api/projects/${id}`, { method: "DELETE" });
    localStorage.removeItem(draftKey(id));
    if (activeProjectId === id) {
      activeProjectId = "";
      savedSnapshot = null;
      localStorage.removeItem("three-preview-project-id");
      persistDraft();
    }
    await refreshProjects();
    saveStatus.textContent = "作品を削除しました";
  } catch (error) { showError(error.message); }
};

const legacyDraft = localStorage.getItem("three-preview-draft");
if (legacyDraft !== null && !readDraft()) {
  localStorage.setItem(draftKey(), snapshotText({
    name: localStorage.getItem("three-preview-draft-name") || "無題",
    code: legacyDraft,
    overrides: imageOverrides
  }));
}
localStorage.removeItem("three-preview-draft");
localStorage.removeItem("three-preview-draft-name");
const initialDraft = readDraft();
if (initialDraft) setEditorState(initialDraft);
else if (!activeProjectId) projectName.value = "無題";
const oldCode = localStorage.getItem("three-preview-code");
if (oldCode && !initialDraft) {
  document.querySelector("#legacy-import").hidden = false;
  document.querySelector("#import-legacy").onclick = () => {
    editor.value = oldCode;
    handleEditorChange();
    document.querySelector("#legacy-import").hidden = true;
  };
}
renderCandidates();
updateSaveButtons();
refreshProjects().then(() => {
  if (activeProjectId) openProject(activeProjectId).catch((error) => { saveStatus.textContent = error.message; });
}).catch((error) => { saveStatus.textContent = error.message; });
