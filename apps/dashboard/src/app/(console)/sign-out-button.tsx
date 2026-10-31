"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";

export function SignOutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  async function signOut() {
    await api.signOut().catch(() => undefined);
    queryClient.clear();
    router.replace("/sign-in");
  }
  return (
    <button type="button" onClick={signOut}>
      Sign out
    </button>
  );
}
