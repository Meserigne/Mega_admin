export type RememberedContact = {
  email: string;
  nom: string;
  usedAt: number;
};

const KEY = "mega-swa-signature-emails";
const MAX = 40;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function loadRememberedContacts(): RememberedContact[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RememberedContact[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c) => c && typeof c.email === "string" && c.email.includes("@"))
      .sort((a, b) => (b.usedAt || 0) - (a.usedAt || 0))
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function rememberContacts(
  contacts: { email: string; nom?: string }[]
): void {
  if (typeof window === "undefined") return;
  try {
    const now = Date.now();
    const map = new Map<string, RememberedContact>();
    for (const c of loadRememberedContacts()) {
      map.set(normalizeEmail(c.email), c);
    }
    for (const c of contacts) {
      const email = normalizeEmail(c.email);
      if (!email.includes("@")) continue;
      const prev = map.get(email);
      map.set(email, {
        email,
        nom: (c.nom || prev?.nom || "").trim(),
        usedAt: now,
      });
    }
    const next = [...map.values()]
      .sort((a, b) => b.usedAt - a.usedAt)
      .slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

export function filterRememberedContacts(
  query: string,
  limit = 8
): RememberedContact[] {
  const q = query.trim().toLowerCase();
  const all = loadRememberedContacts();
  if (!q) return all.slice(0, limit);
  return all
    .filter(
      (c) =>
        c.email.includes(q) ||
        (c.nom && c.nom.toLowerCase().includes(q))
    )
    .slice(0, limit);
}
