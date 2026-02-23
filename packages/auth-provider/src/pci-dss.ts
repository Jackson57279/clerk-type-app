export interface PciDssCardDataPolicy {
  noCardDataStorage: boolean;
}

export function getPciDssCardDataPolicy(): PciDssCardDataPolicy {
  return { noCardDataStorage: true };
}

const PAN_MIN_LEN = 13;
const PAN_MAX_LEN = 19;

function luhnChecksum(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const c = digits.charAt(i);
    let n = parseInt(c, 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function containsPan(digits: string): boolean {
  for (let len = PAN_MIN_LEN; len <= PAN_MAX_LEN; len++) {
    for (let i = 0; i + len <= digits.length; i++) {
      const segment = digits.slice(i, i + len);
      if (luhnChecksum(segment)) return true;
    }
  }
  return false;
}

export function containsCardData(value: string): boolean {
  if (typeof value !== "string" || value.length < PAN_MIN_LEN) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= PAN_MIN_LEN && containsPan(digits);
}

export function validateNoCardData(
  value: string
): { ok: true } | { ok: false; reason: string } {
  if (containsCardData(value)) {
    return { ok: false, reason: "Value appears to contain card data (PAN)" };
  }
  return { ok: true };
}

export function validateNoCardDataInRecord(
  record: Record<string, string | string[] | undefined>
): { ok: true } | { ok: false; reason: string } {
  for (const v of Object.values(record)) {
    if (v === undefined) continue;
    if (typeof v === "string") {
      const r = validateNoCardData(v);
      if (!r.ok) return r;
    } else {
      for (const s of v) {
        const r = validateNoCardData(s);
        if (!r.ok) return r;
      }
    }
  }
  return { ok: true };
}
