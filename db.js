import { createClient } from "@libsql/client";

const url = process.env.TURSO_URL;
const authToken = process.env.TURSO_TOKEN;

if (!url) {
  throw new Error("TURSO_URL 환경변수가 설정되지 않았습니다.");
}

export const db = createClient({ url, authToken });

// 앱 시작 시 스키마를 보장한다.
export async function initSchema() {
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS notebooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        notebook_id TEXT,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        is_pinned INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE SET NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes(notebook_id)`,
      `CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC)`,
    ],
    "write"
  );
}
