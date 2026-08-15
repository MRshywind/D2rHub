import type { AccountMeta } from "../store/types";
import { validateOcrTarget } from "./ocrTarget";

function account(overrides: Partial<AccountMeta> = {}): AccountMeta {
  return {
    id: "acount1",
    display_name: "Ladder Sorc",
    mod_args: "",
    created_at: "2026-08-10T00:00:00Z",
    last_launched_at: null,
    last_reset_at: null,
    initialized: true,
    order: 0,
    is_running: false,
    ...overrides,
  };
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

export function runTests() {
  const initialized = account();
  const uninitialized = account({ id: "acount2", initialized: false });
  const accounts = [initialized, uninitialized];

  const missing = validateOcrTarget("", accounts);
  assert(!missing.valid && missing.reason === "missing", "OCR requires a selected account");

  const unknown = validateOcrTarget("missing-account", accounts);
  assert(!unknown.valid && unknown.reason === "not_found", "OCR rejects an unknown account");

  const notInitialized = validateOcrTarget("acount2", accounts);
  assert(
    !notInitialized.valid && notInitialized.reason === "not_initialized",
    "OCR rejects an uninitialized account",
  );

  const valid = validateOcrTarget("acount1", accounts);
  assert(valid.valid && valid.account === initialized, "OCR accepts the selected initialized account");
}

const g = globalThis as any;
if (typeof g.process !== "undefined" && typeof g.process.argv !== "undefined") {
  try {
    runTests();
  } catch (error) {
    console.error(error);
    g.process.exit(1);
  }
}
