import type { Metadata } from "next";

import { loginAction } from "@/actions/auth";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "Anmelden · GymTracker" };

export default function LoginPage() {
  return <AuthForm mode="login" action={loginAction} />;
}
