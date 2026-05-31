/**
 * phone.ts
 * Utility for normalizing phone numbers to E.164-like format.
 */

export function normalizePhone(raw: string): string {
  // Pass-through for WhatsApp LID synthetic keys ("lid:<numericId>").
  // These are privacy-preserving identifiers, not real phone numbers.
  if (raw.startsWith("lid:")) return raw;

  // 1. Remove all non-numeric characters (including whitespace, dashes, pluses)
  const digitsOnly = raw.replace(/\D/g, "");
  
  if (!digitsOnly) return "";

  // 2. We assume numbers should have country code.
  // We'll enforce a leading '+' for normalized CRM display and database uniqueness.
  // For Indian numbers without country code, we don't automatically guess "91" 
  // because this might be an international CRM. But WhatsApp ids usually contain country codes.
  // E.g., WhatsApp provides 919876543210@c.us -> 919876543210 -> +919876543210
  return `+${digitsOnly}`;
}
