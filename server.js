import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { db, initSchema } from "./db.js";
import {
  checkPassword,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  isAuthed,
} from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

const now = () => Date.now();
const newId = () => crypto.randomUUID();

/* ---------------- 인증 ---------------- */

app.post("/api/login", (req, res) => {
  if (!checkPassword(req.body?.password)) {
    return res.status(401).json({ error: "비밀번호가 올바르지 않습니다." });
  }
  setSessionCookie(res);
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  res.json({ authed: isAuthed(req) });
});

/* ---------------- 노트북 ---------------- */

app.get("/api/notebooks", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.execute(
      `SELECT nb.id, nb.name, nb.created_at,
              (SELECT COUNT(*) FROM notes n WHERE n.notebook_id = nb.id) AS note_count
       FROM notebooks nb ORDER BY nb.name COLLATE NOCASE ASC`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

app.post("/api/notebooks", requireAuth, async (req, res, next) => {
  try {
    const name = (req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "이름이 필요합니다." });
    const id = newId();
    await db.execute({
      sql: "INSERT INTO notebooks (id, name, created_at) VALUES (?, ?, ?)",
      args: [id, name, now()],
    });
    res.json({ id, name, created_at: now(), note_count: 0 });
  } catch (e) {
    next(e);
  }
});

app.put("/api/notebooks/:id", requireAuth, async (req, res, next) => {
  try {
    const name = (req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "이름이 필요합니다." });
    await db.execute({
      sql: "UPDATE notebooks SET name = ? WHERE id = ?",
      args: [name, req.params.id],
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.delete("/api/notebooks/:id", requireAuth, async (req, res, next) => {
  try {
    // 노트는 보존하고 미분류 상태로 만든다.
    await db.execute({
      sql: "UPDATE notes SET notebook_id = NULL WHERE notebook_id = ?",
      args: [req.params.id],
    });
    await db.execute({
      sql: "DELETE FROM notebooks WHERE id = ?",
      args: [req.params.id],
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ---------------- 노트 ---------------- */

app.get("/api/notes", requireAuth, async (req, res, next) => {
  try {
    const { notebook, q } = req.query;
    const where = [];
    const args = [];
    if (notebook === "_uncat") {
      where.push("notebook_id IS NULL");
    } else if (notebook) {
      where.push("notebook_id = ?");
      args.push(notebook);
    }
    if (q && q.trim()) {
      where.push("(title LIKE ? OR content LIKE ?)");
      const like = `%${q.trim()}%`;
      args.push(like, like);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await db.execute({
      sql: `SELECT id, notebook_id, title, is_pinned, created_at, updated_at,
              substr(content, 1, 2000) AS content
            FROM notes ${clause}
            ORDER BY is_pinned DESC, updated_at DESC`,
      args,
    });
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

app.get("/api/notes/:id", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.execute({
      sql: "SELECT * FROM notes WHERE id = ?",
      args: [req.params.id],
    });
    if (!rows.length) return res.status(404).json({ error: "not found" });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

app.post("/api/notes", requireAuth, async (req, res, next) => {
  try {
    const id = newId();
    const t = now();
    const notebook_id = req.body?.notebook_id || null;
    const title = req.body?.title ?? "";
    const content = req.body?.content ?? "";
    await db.execute({
      sql: `INSERT INTO notes (id, notebook_id, title, content, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [id, notebook_id, title, content, t, t],
    });
    res.json({
      id,
      notebook_id,
      title,
      content,
      is_pinned: 0,
      created_at: t,
      updated_at: t,
    });
  } catch (e) {
    next(e);
  }
});

app.put("/api/notes/:id", requireAuth, async (req, res, next) => {
  try {
    const fields = [];
    const args = [];
    for (const key of ["title", "content", "notebook_id", "is_pinned"]) {
      if (key in (req.body || {})) {
        fields.push(`${key} = ?`);
        args.push(req.body[key]);
      }
    }
    if (!fields.length) return res.json({ ok: true });
    fields.push("updated_at = ?");
    args.push(now());
    args.push(req.params.id);
    await db.execute({
      sql: `UPDATE notes SET ${fields.join(", ")} WHERE id = ?`,
      args,
    });
    res.json({ ok: true, updated_at: now() });
  } catch (e) {
    next(e);
  }
});

app.delete("/api/notes/:id", requireAuth, async (req, res, next) => {
  try {
    await db.execute({
      sql: "DELETE FROM notes WHERE id = ?",
      args: [req.params.id],
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ---------------- 정적 파일 ---------------- */

app.use(express.static(path.join(__dirname, "public")));

// 에러 핸들러
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "server error" });
});

initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`📝 Notepad running on http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    console.error("스키마 초기화 실패:", e);
    process.exit(1);
  });
