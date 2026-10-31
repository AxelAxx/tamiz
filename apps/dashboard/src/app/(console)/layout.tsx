import Link from "next/link";
import type { ReactNode } from "react";
import { GatewayStatus } from "./gateway-status";
import { SignOutButton } from "./sign-out-button";

/** The seven console screens; unstyled until the shell of `T-008-10` (gate G1). */
const SCREENS = [
  { href: "/live", label: "Live traffic" },
  { href: "/simulator", label: "Simulator" },
  { href: "/audit", label: "Audit log" },
  { href: "/policy", label: "Policy" },
  { href: "/evals", label: "Evals" },
  { href: "/providers", label: "Providers" },
  { href: "/cost", label: "Cost" },
] as const;

export default function ConsoleLayout({ children }: { readonly children: ReactNode }) {
  return (
    <>
      <nav aria-label="Screens">
        <ul>
          {SCREENS.map((screen) => (
            <li key={screen.href}>
              <Link href={screen.href}>{screen.label}</Link>
            </li>
          ))}
        </ul>
        <GatewayStatus />
        <SignOutButton />
      </nav>
      <main>{children}</main>
    </>
  );
}
