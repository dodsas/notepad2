import crypto from "crypto";

const SECRET =
  process.env.SESSION_SECRET || process.env.TURSO_TOKEN || "dev-insecure-secret";
const PASSWORD = process.env.APP_PASSWORD || "changeme";
const COOKIE_NAME = "np_session";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30일

function sign(payload) {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
}

// 만료 시각을 담은 서명 토큰을 만든다.
function makeToken() {
  const exp = String(Date.now() + MAX_AGE_MS);
  return `${exp}.${sign(exp)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string") return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig) return false;
  // 타이밍 안전 비교
  const expected = sign(exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(exp) > Date.now();
}

export function checkPassword(input) {
  if (typeof input !== "string") return false;
  const a = Buffer.from(input);
  const b = Buffer.from(PASSWORD);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function setSessionCookie(res) {
  res.cookie(COOKIE_NAME, makeToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_MS,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

// API 라우트 보호 미들웨어
export function requireAuth(req, res, next) {
  if (verifyToken(req.cookies?.[COOKIE_NAME])) return next();
  res.status(401).json({ error: "unauthorized" });
}

export function isAuthed(req) {
  return verifyToken(req.cookies?.[COOKIE_NAME]);
}
