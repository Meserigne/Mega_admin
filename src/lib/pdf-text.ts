/**
 * Helvetica (WinAnsi) ne gère pas les accents combinants (NFD) ni l'Unicode étendu.
 * Ex. "associé" en NFD → e + U+0301 → crash pdf-lib.
 */
export function pdfSafeText(input: string, fallback = "?"): string {
  return input
    .normalize("NFC")
    .replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, fallback)
    .replace(/\s+/g, " ")
    .trim();
}
