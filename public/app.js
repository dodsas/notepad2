/* ============ API 헬퍼 ============ */
const api = {
  async req(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (res.status === 401) {
      showLogin();
      throw new Error("unauthorized");
    }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "error");
    return res.status === 204 ? null : res.json();
  },
  get: (u) => api.req("GET", u),
  post: (u, b) => api.req("POST", u, b),
  put: (u, b) => api.req("PUT", u, b),
  del: (u) => api.req("DELETE", u),
};

/* ============ 상태 ============ */
const state = {
  notebooks: [],
  notes: [],
  currentNotebook: "", // "" = 전체, "_uncat" = 미분류, 그 외 = id
  currentNoteId: null,
  search: "",
};
let quill;
let saveTimer = null;

/* ============ 엘리먼트 ============ */
const $ = (id) => document.getElementById(id);
const loginScreen = $("login-screen");
const appEl = $("app");

/* ============ 인증 ============ */
async function checkAuth() {
  try {
    const { authed } = await api.get("/api/me");
    if (authed) startApp();
    else showLogin();
  } catch {
    showLogin();
  }
}

function showLogin() {
  loginScreen.classList.remove("hidden");
  appEl.classList.add("hidden");
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errBox = $("login-error");
  errBox.textContent = "";
  try {
    await api.post("/api/login", { password: $("password").value });
    $("password").value = "";
    startApp();
  } catch (err) {
    errBox.textContent =
      err.message === "unauthorized" ? "비밀번호가 올바르지 않습니다." : err.message;
  }
});

$("logout-btn").addEventListener("click", async () => {
  await api.post("/api/logout");
  location.reload();
});

/* ============ 앱 시작 ============ */
async function startApp() {
  loginScreen.classList.add("hidden");
  appEl.classList.remove("hidden");
  if (!quill) initEditor();
  await loadNotebooks();
  await loadNotes();
}

function initEditor() {
  quill = new Quill("#editor", {
    theme: "snow",
    placeholder: "여기에 작성하세요…",
    modules: {
      toolbar: [
        [{ header: [1, 2, 3, false] }],
        ["bold", "italic", "underline", "strike"],
        [{ color: [] }, { background: [] }],
        [{ list: "ordered" }, { list: "bullet" }],
        [{ indent: "-1" }, { indent: "+1" }],
        ["blockquote", "code-block", "link"],
        ["clean"],
      ],
    },
  });
  quill.on("text-change", (_d, _o, source) => {
    if (source === "user") scheduleSave();
  });
}

/* ============ 노트북 ============ */
async function loadNotebooks() {
  state.notebooks = await api.get("/api/notebooks");
  renderNotebooks();
  renderNotebookSelect();
}

function renderNotebooks() {
  const ul = $("notebook-list");
  ul.innerHTML = "";
  for (const nb of state.notebooks) {
    const li = document.createElement("li");
    if (state.currentNotebook === nb.id) li.setAttribute("data-active", "");
    li.innerHTML = `
      <span class="nb-name">📓 ${escapeHtml(nb.name)}</span>
      <span class="nb-count">${nb.note_count}</span>
      <span class="nb-actions">
        <button data-act="rename" title="이름변경">✏️</button>
        <button data-act="delete" title="삭제">🗑️</button>
      </span>`;
    li.querySelector(".nb-name").addEventListener("click", () => selectNotebook(nb.id));
    li.querySelector('[data-act="rename"]').addEventListener("click", (e) => {
      e.stopPropagation();
      renameNotebook(nb);
    });
    li.querySelector('[data-act="delete"]').addEventListener("click", (e) => {
      e.stopPropagation();
      deleteNotebook(nb);
    });
    ul.appendChild(li);
  }
  // 기본 네비 활성화 표시
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.toggleAttribute("data-active", el.dataset.notebook === state.currentNotebook);
  });
}

function renderNotebookSelect() {
  const sel = $("note-notebook");
  sel.innerHTML = '<option value="">미분류</option>';
  for (const nb of state.notebooks) {
    const o = document.createElement("option");
    o.value = nb.id;
    o.textContent = nb.name;
    sel.appendChild(o);
  }
}

document.querySelectorAll(".nav-item").forEach((el) => {
  el.addEventListener("click", () => selectNotebook(el.dataset.notebook));
});

$("add-notebook").addEventListener("click", async () => {
  const name = prompt("새 노트북 이름:");
  if (!name || !name.trim()) return;
  await api.post("/api/notebooks", { name: name.trim() });
  await loadNotebooks();
});

async function renameNotebook(nb) {
  const name = prompt("노트북 이름 변경:", nb.name);
  if (!name || !name.trim()) return;
  await api.put(`/api/notebooks/${nb.id}`, { name: name.trim() });
  await loadNotebooks();
}

async function deleteNotebook(nb) {
  if (!confirm(`'${nb.name}' 노트북을 삭제할까요?\n(안의 노트는 미분류로 이동합니다)`)) return;
  await api.del(`/api/notebooks/${nb.id}`);
  if (state.currentNotebook === nb.id) state.currentNotebook = "";
  await loadNotebooks();
  await loadNotes();
}

function selectNotebook(id) {
  state.currentNotebook = id;
  renderNotebooks();
  updateListTitle();
  loadNotes();
}

function updateListTitle() {
  const t = $("list-title");
  if (state.currentNotebook === "") t.textContent = "모든 노트";
  else if (state.currentNotebook === "_uncat") t.textContent = "미분류";
  else {
    const nb = state.notebooks.find((n) => n.id === state.currentNotebook);
    t.textContent = nb ? nb.name : "노트";
  }
}

/* ============ 노트 목록 ============ */
async function loadNotes() {
  const params = new URLSearchParams();
  if (state.currentNotebook) params.set("notebook", state.currentNotebook);
  if (state.search) params.set("q", state.search);
  state.notes = await api.get(`/api/notes?${params.toString()}`);
  renderNoteList();
}

function renderNoteList() {
  const ul = $("note-list");
  ul.innerHTML = "";
  if (!state.notes.length) {
    ul.innerHTML = '<div class="empty-msg">노트가 없습니다.</div>';
    return;
  }
  for (const n of state.notes) {
    const li = document.createElement("li");
    if (n.id === state.currentNoteId) li.setAttribute("data-active", "");
    li.innerHTML = `
      <div class="n-title">${n.is_pinned ? '<span class="pin">📌</span> ' : ""}${
      escapeHtml(n.title) || "<em>제목 없음</em>"
    }</div>
      <div class="n-snippet">${escapeHtml(stripHtml(n.content)) || "내용 없음"}</div>
      <div class="n-date">${fmtDate(n.updated_at)}</div>`;
    li.addEventListener("click", () => openNote(n.id));
    ul.appendChild(li);
  }
}

$("search").addEventListener("input", (e) => {
  state.search = e.target.value;
  clearTimeout(saveTimer);
  setTimeout(() => loadNotes(), 250);
});

/* ============ 노트 열기/편집 ============ */
$("new-note").addEventListener("click", async () => {
  const notebook_id =
    state.currentNotebook && state.currentNotebook !== "_uncat"
      ? state.currentNotebook
      : null;
  const note = await api.post("/api/notes", {
    title: "",
    content: "",
    notebook_id,
  });
  await loadNotebooks();
  await loadNotes();
  openNote(note.id);
  $("note-title").focus();
});

async function openNote(id) {
  flushSave(); // 이전 노트 저장 보장
  const note = await api.get(`/api/notes/${id}`);
  state.currentNoteId = id;
  $("editor-empty").classList.add("hidden");
  $("editor-wrap").classList.remove("hidden");
  $("note-title").value = note.title || "";
  $("note-notebook").value = note.notebook_id || "";
  quill.root.innerHTML = note.content || "";
  setPinUI(note.is_pinned);
  $("save-status").textContent = "저장됨 · " + fmtDate(note.updated_at);
  renderNoteList();
}

$("note-title").addEventListener("input", scheduleSave);
$("note-notebook").addEventListener("change", async () => {
  await saveNote();
  await loadNotebooks();
  await loadNotes();
});

$("pin-btn").addEventListener("click", async () => {
  const note = state.notes.find((n) => n.id === state.currentNoteId);
  const newVal = note && note.is_pinned ? 0 : 1;
  await api.put(`/api/notes/${state.currentNoteId}`, { is_pinned: newVal });
  setPinUI(newVal);
  await loadNotes();
});

function setPinUI(pinned) {
  $("pin-btn").classList.toggle("active", !!pinned);
}

$("delete-note").addEventListener("click", async () => {
  if (!state.currentNoteId) return;
  if (!confirm("이 노트를 삭제할까요?")) return;
  await api.del(`/api/notes/${state.currentNoteId}`);
  state.currentNoteId = null;
  $("editor-wrap").classList.add("hidden");
  $("editor-empty").classList.remove("hidden");
  await loadNotebooks();
  await loadNotes();
});

/* ============ 자동 저장 ============ */
function scheduleSave() {
  $("save-status").textContent = "편집 중…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNote, 700);
}

function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveNote();
  }
}

async function saveNote() {
  if (!state.currentNoteId) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const title = $("note-title").value;
  const content = quill.root.innerHTML;
  const notebook_id = $("note-notebook").value || null;
  try {
    const r = await api.put(`/api/notes/${state.currentNoteId}`, {
      title,
      content,
      notebook_id,
    });
    $("save-status").textContent = "저장됨 · " + fmtDate(r.updated_at);
    // 목록의 해당 항목 갱신
    const n = state.notes.find((x) => x.id === state.currentNoteId);
    if (n) {
      n.title = title;
      n.content = content;
      n.updated_at = r.updated_at;
      renderNoteList();
    }
  } catch (e) {
    $("save-status").textContent = "저장 실패: " + e.message;
  }
}

// 페이지 떠나기 전 저장
window.addEventListener("beforeunload", () => {
  if (saveTimer && state.currentNoteId) {
    navigator.sendBeacon?.(
      `/api/notes/${state.currentNoteId}`,
      new Blob([], { type: "application/json" })
    );
  }
});

/* ============ 유틸 ============ */
function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function stripHtml(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  return (tmp.textContent || "").trim();
}
function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts));
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay)
    return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  });
}

/* ============ 시작 ============ */
checkAuth();
