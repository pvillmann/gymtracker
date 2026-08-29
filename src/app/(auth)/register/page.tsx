import type { Metadata } from "next";

import { registerAction } from "@/actions/auth";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "Registrieren · GymTracker" };

export default function RegisterPage() {
  return (
    <AuthForm
      mode="register"
      action={registerAction}
      requiresCode={Boolean(process.env.REGISTRATION_CODE)}
    />
  );
}
