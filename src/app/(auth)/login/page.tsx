import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const auth = await getAuth();
  if (auth.user) redirect(auth.profile ? "/" : "/profiles");
  const sp = await searchParams;
  return <LoginForm initialError={sp.error} />;
}
