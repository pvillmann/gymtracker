import "server-only";

import { createEmailVerificationToken } from "@/lib/auth";
import { appUrl, sendVerificationEmail } from "@/lib/mail";

/**
 * Legt einen Bestätigungstoken an und verschickt den Link.
 *
 * Liegt bewusst hier und nicht in einem "use server"-Modul: dort wäre jede
 * exportierte Funktion ein von außen aufrufbarer Endpunkt, und eine, die zu
 * beliebigen Adressen Mails schickt, will man nicht offen haben.
 *
 * Wirft nicht – ein kaputter SMTP-Server soll die Registrierung nicht
 * abbrechen. Der Rückgabewert sagt, ob die Mail rausging.
 */
export async function sendVerificationLink(
  userId: string,
  email: string,
  name: string,
): Promise<boolean> {
  const token = await createEmailVerificationToken(userId);
  try {
    await sendVerificationEmail(email, name, appUrl(`/verify-email?token=${token}`));
    return true;
  } catch (error) {
    console.error("Verifizierungsmail konnte nicht verschickt werden:", error);
    return false;
  }
}
