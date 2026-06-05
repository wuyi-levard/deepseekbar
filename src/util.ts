// src/util.ts - shared HTML escaping helpers

export function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}
