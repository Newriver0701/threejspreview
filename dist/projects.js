const projectName = document.querySelector("#project-name");
const projectList = document.querySelector("#project-list");
const saveStatus = document.querySelector("#save-status");
const candidates = document.querySelector("#asset-candidates");
let activeProjectId = localStorage.getItem("three-preview-project-id") || "";
let saveTimer;
let saveQueue = Promise.resolve();
let imageOverrides = JSON.parse(localStorage.getItem("three-preview-image-overrides") || "{}");
let runtimeCandidates = [];

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
  localStorage.setItem("three-preview-draft", editor.value);
  localStorage.setItem("three-preview-draft-name", projectName.value);
  saveStatus.textContent = "保存待ち";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!activeProjectId) {
      saveStatus.textContent = "下書きを端末に保存済み";
      return;
    }
    const id = activeProjectId;
    const payload = JSON.stringify({ name: projectName.value, code: editor.value, overrides: imageOverrides });
    saveQueue = saveQueue.then(async () => {
      await api(`/api/projects/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: payload });
      saveStatus.textContent = "自動保存済み";
    }).catch((error) => { saveStatus.textContent = error.message; });
  }, 800);
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
  if (!id) return;
  if (activeProjectId && activeProjectId !== id) {
    clearTimeout(saveTimer);
    const previousId = activeProjectId;
    const previous = JSON.stringify({ name: projectName.value, code: editor.value, overrides: imageOverrides });
    await saveQueue;
    await api(`/api/projects/${previousId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: previous });
  }
  clearTimeout(saveTimer);
  await saveQueue;
  const project = await api(`/api/projects/${id}`);
  activeProjectId = id;
  localStorage.setItem("three-preview-project-id", id);
  projectName.value = project.name;
  editor.value = project.code;
  imageOverrides = project.image_overrides || {};
  localStorage.setItem("three-preview-image-overrides", JSON.stringify(imageOverrides));
  localStorage.setItem("three-preview-draft", editor.value);
  renderCandidates();
  saveStatus.textContent = "作品を読み込みました";
  runCode();
}

async function createProject(name = projectName.value) {
  clearTimeout(saveTimer);
  await saveQueue;
  const project = await api("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, code: editor.value, overrides: imageOverrides }) });
  activeProjectId = project.id;
  localStorage.setItem("three-preview-project-id", project.id);
  projectName.value = project.name;
  saveStatus.textContent = "作品を保存しました";
  await refreshProjects();
}

editor.addEventListener("input", handleEditorChange);
projectName.addEventListener("input", persistDraft);
document.querySelector("#save-project").onclick = () => createProject().catch((error) => showError(error.message));
document.querySelector("#duplicate-project").onclick = () => createProject(`${projectName.value} のコピー`).catch((error) => showError(error.message));
document.querySelector("#open-project").onclick = () => openProject(projectList.value).catch((error) => showError(error.message));
document.querySelector("#delete-project").onclick = async () => {
  if (!projectList.value || !confirm("この作品を削除しますか？")) return;
  try {
    const id = projectList.value;
    await api(`/api/projects/${id}`, { method: "DELETE" });
    if (activeProjectId === id) { activeProjectId = ""; localStorage.removeItem("three-preview-project-id"); }
    await refreshProjects();
    saveStatus.textContent = "作品を削除しました";
  } catch (error) { showError(error.message); }
};

projectName.value = localStorage.getItem("three-preview-draft-name") || "無題";
const oldCode = localStorage.getItem("three-preview-code");
if (oldCode && !localStorage.getItem("three-preview-draft")) {
  document.querySelector("#legacy-import").hidden = false;
  document.querySelector("#import-legacy").onclick = () => {
    editor.value = oldCode;
    handleEditorChange();
    document.querySelector("#legacy-import").hidden = true;
  };
}
renderCandidates();
refreshProjects().then(() => {
  if (activeProjectId && !localStorage.getItem("three-preview-draft")) openProject(activeProjectId).catch(() => {});
}).catch((error) => { saveStatus.textContent = error.message; });
