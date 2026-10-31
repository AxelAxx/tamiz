"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { api, BffRequestError } from "@/lib/api-client";

function messageFor(error: unknown): string {
  if (error instanceof BffRequestError) {
    if (error.status === 429) return "Too many failed attempts. Try again in a minute.";
    if (error.status === 401) return "Wrong passphrase.";
  }
  return "Sign-in failed. Try again.";
}

export function SignInForm() {
  const router = useRouter();
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const passphrase = new FormData(event.currentTarget).get("passphrase");
    setPending(true);
    setError(undefined);
    try {
      await api.signIn(typeof passphrase === "string" ? passphrase : "");
      router.replace("/live");
    } catch (failure) {
      setError(messageFor(failure));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <label htmlFor="passphrase">Passphrase</label>
      <input id="passphrase" name="passphrase" type="password" autoComplete="current-password" />
      <button type="submit" disabled={pending}>
        Sign in
      </button>
      {error === undefined ? null : <p role="alert">{error}</p>}
    </form>
  );
}
