"use server";

import { redirect } from "next/navigation";
import { bootstrap } from "@/db/bootstrap";
import {
  AccountError,
  completePairing,
  DEMO_CREDENTIALS,
  getPairing,
  provisionAccount,
  type Credentials,
} from "@/lib/account";
import { createSession, destroySession, startSessionFor } from "@/lib/auth";

export interface AuthFormState {
  error?: string;
}

export interface PairFormState {
  error?: string;
  ok?: boolean;
  name?: string;
  syncError?: string | null;
}

function credentialsFrom(formData: FormData): Credentials {
  return {
    serverUrl: String(formData.get("serverUrl") ?? "").trim(),
    username: String(formData.get("username") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof AccountError) return err.message;
  console.error("[auth] unexpected error", err);
  return "Error inesperado al iniciar sesión. Inténtalo de nuevo.";
}

/** Sign in with provider URL + username + password (Xtream Codes API). */
export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  await bootstrap();
  let userId: number;
  try {
    const result = await provisionAccount(credentialsFrom(formData));
    userId = result.user.id;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  redirect(await startSessionFor(userId));
}

/** One-click access to the built-in demo catalogue. */
export async function demoLoginAction(): Promise<void> {
  await bootstrap();
  let userId: number;
  try {
    const result = await provisionAccount(DEMO_CREDENTIALS);
    userId = result.user.id;
  } catch (err) {
    console.error("[auth] demo login failed", err);
    redirect("/login?error=demo");
  }
  redirect(await startSessionFor(userId));
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

/**
 * Submitted from the phone after scanning the TV's QR code. Validates the
 * credentials, links the account to the pairing code (so the TV can claim it)
 * and also signs this phone in.
 */
export async function pairSubmitAction(_prev: PairFormState, formData: FormData): Promise<PairFormState> {
  await bootstrap();
  const code = String(formData.get("code") ?? "");
  const pairing = await getPairing(code);
  if (!pairing) return { error: "El código ha caducado o no es válido. Genera uno nuevo en la TV." };
  if (pairing.status !== "pending") return { error: "Este código ya se ha utilizado." };

  try {
    const result = await provisionAccount(credentialsFrom(formData));
    const linked = await completePairing(code, result.user.id);
    if (!linked) return { error: "El código caducó mientras se validaban los datos. Genera uno nuevo en la TV." };
    await createSession(result.user.id);
    return { ok: true, name: result.user.name, syncError: result.syncError };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
