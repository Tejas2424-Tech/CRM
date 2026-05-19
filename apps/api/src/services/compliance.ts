const optOutWords = new Set(["STOP", "UNSUBSCRIBE", "NO"]);

export function isOptOutMessage(text: string) {
  return optOutWords.has(text.trim().toUpperCase());
}

export function maskPhone(phone: string) {
  if (phone.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`;
}
