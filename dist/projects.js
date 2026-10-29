const projectName = document.querySelector("#project-name");
const projectList = document.querySelector("#project-list");
const saveStatus = document.querySelector("#save-status");
const candidates = document.querySelector("#asset-candidates");
let activeProjectId = localStorage.getItem("three-preview-project-id") || "";
let saveTimer;
let saveQueue = Promise.resolve();

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
    const payload = JSON.stringify({ name: projectName.value, code: editor.value });
    saveQueue = saveQueue.then(async () => {
      await api(`/api/projects/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: payload });
      saveStatus.textContent = "自動保存済み";
    }).catch((error) => { saveStatus.textContent = error.message; });
  }, 800);
}

function imageReferences(code) {
  const found = [];
  const add = (start, end, label) => {
    if (found.some((item) => start < item.end && end > item.start)) return;
    found.push({ start, end, url: code.slice(start, end), label,
      line: code.slice(0, start).split("\n").length });
  };
  // Only literal values can be safely replaced without changing JavaScript behavior.
  const loaders = /(?:\.load\s*\(|\.src\s*=\s*|setAttribute\s*\(\s*['"]src['"]\s*,\s*)(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g;
  for (const match of code.matchAll(loaders)) {
    const value = match[2];
    if (!value || value.includes("${")) continue;
    const start = match.index + match[0].indexOf(value);
    add(start, start + value.length, "画像参照");
  }
  const embedded = /(['"`])(data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+)\1/g;
  for (const match of code.matchAll(embedded)) {
    const start = match.index + 1;
    add(start, start + match[2].length, "埋め込み画像");
  }
  const slots = /\/\/\s*@image-slot:\s*([^\n]+)\n\s*(['"`])([^'"`\n]+)\2/g;
  for (const match of code.matchAll(slots)) {
    const start = match.index + match[0].lastIndexOf(match[3]);
    add(start, start + match[3].length, match[1].trim());
  }
  return found.sort((a, b) => a.start - b.start);
}

function renderCandidates() {
  candidates.replaceChildren();
  const references = imageReferences(editor.value);
  if (!references.length) {
    const empty = document.createElement("p");
    empty.textContent = "画像参照が見つかりません。コードに // @image-slot: カード画像 を追加できます。";
    candidates.append(empty);
    return;
  }
  for (const reference of references) {
    const row = document.createElement("div");
    row.className = "asset-row";
    const img = document.createElement("img");
    img.alt = "現在の画像";
    img.src = reference.url;
    img.onerror = () => { img.hidden = true; };
    const label = document.createElement("span");
    label.textContent = `${reference.label} · ${reference.line}行目 · ${reference.url.slice(0, 55)}`;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.setAttribute("aria-label", `${reference.line}行目の画像をアップロード`);
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { showError("画像は1枚5MBまでです。"); return; }
      try {
        input.disabled = true;
        const stored = await api("/api/assets", { method: "POST", headers: { "Content-Type": file.type }, body: file });
        const current = imageReferences(editor.value).find((item) => item.start === reference.start && item.url === reference.url);
        if (!current) throw new Error("コードが変更されました。画像候補を選び直してください。");
        editor.value = editor.value.slice(0, current.start) + stored.url + editor.value.slice(current.end);
        handleEditorChange();
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
    const previous = JSON.stringify({ name: projectName.value, code: editor.value });
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
  localStorage.setItem("three-preview-draft", editor.value);
  renderCandidates();
  saveStatus.textContent = "作品を読み込みました";
  runCode();
}

async function createProject(name = projectName.value) {
  clearTimeout(saveTimer);
  await saveQueue;
  const project = await api("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, code: editor.value }) });
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
