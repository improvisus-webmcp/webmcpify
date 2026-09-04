export function normalizeTargetUrl(value: string): string {
  const trimmed = value.trim();
  const markdownLink = trimmed.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
  const candidate = markdownLink?.[2] ?? trimmed;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(
      'Invalid target URL "' + value + '". Use a plain URL such as http://localhost:5173 (not Markdown link syntax).',
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error('Unsupported target URL protocol "' + parsed.protocol + '". Use http:// or https://.');
  }
  return parsed.toString().replace(/\/$/, "");
}
