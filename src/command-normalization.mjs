export function directArguments(command) {
  const parts = String(command || "").trim().split(/\s+/u).filter(Boolean);
  return parts.length > 0 && parts.every((part) => /^[A-Za-z0-9_./:@=+,%-]+$/u.test(part)) ? parts : null;
}

function failureKind(result) {
  // These are actual Node child_process error categories, NOT proof that
  // compute ran inside a kernel sandbox or that customer Work was accepted.
  const code = result?.error?.code;
  if (code === "ETIMEDOUT") return "deadline";
  if (code === "ENOBUFS") return "output-limit";
  if (code === "ABORT_ERR") return "cancelled";
  if (result?.error) return "spawn-error";
  if (typeof result?.signal === "string" && result.status === null) return "signaled";
  if (result?.status === 0) return null;
  return "nonzero-exit";
}

function boundedText(source, maxBytes) {
  const text = typeof source === "string" ? source : "";
  if (maxBytes === undefined) return text;
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength <= maxBytes) return text;
  return bytes.subarray(0, maxBytes).toString("utf8") +
    "\n[local captured output cropped to declared per-stream byte budget]";
}

export function normalizeCommandResult(result, { maxOutputBytes } = {}) {
  const reason = failureKind(result);
  return Object.freeze({
    code: Number.isInteger(result?.status) ? result.status : null,
    stdout: boundedText(result?.stdout, maxOutputBytes),
    stderr: boundedText(result?.stderr, maxOutputBytes),
    error: result?.error?.message || "",
    cancelled: reason === "cancelled" || reason === "signaled",
    failureKind: reason,
  });
}

export function normalizeVerificationResult(result) {
  const passed = result.code === 0 && result.failureKind == null;
  return Object.freeze({
    passed,
    output: `exit=${result.code}\n${result.stdout}\n${result.stderr}\n${result.error}`,
    failureKind: passed ? null : result.failureKind ?? "nonzero-exit",
  });
}
