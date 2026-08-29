/**
 * FormData.get() liefert null, wenn ein Feld gar nicht im Formular steht –
 * Zods .optional() erwartet dagegen undefined. Diese Helfer übersetzen das,
 * damit ein nicht gerendertes Feld nicht die ganze Validierung kippt.
 */
export function optionalText(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return value === null ? undefined : String(value);
}

export function text(formData: FormData, key: string, fallback = ""): string {
  const value = formData.get(key);
  return value === null ? fallback : String(value);
}
