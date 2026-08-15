import type { AccountMeta } from "../store/types";

export type OcrTargetValidation =
  | { valid: true; account: AccountMeta }
  | { valid: false; reason: "missing" | "not_found" | "not_initialized" };

export function validateOcrTarget(
  accountId: string,
  accounts: AccountMeta[],
): OcrTargetValidation {
  const normalizedId = accountId.trim();
  if (!normalizedId) return { valid: false, reason: "missing" };

  const account = accounts.find((candidate) => candidate.id === normalizedId);
  if (!account) return { valid: false, reason: "not_found" };
  if (!account.initialized) return { valid: false, reason: "not_initialized" };

  return { valid: true, account };
}
