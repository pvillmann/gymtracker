/** Rückgabewert aller Form-Actions, passend für React `useActionState`. */
export type FormState = { error?: string; ok?: boolean };

export const noError: FormState = {};

export function fail(error: string): FormState {
  return { error };
}
