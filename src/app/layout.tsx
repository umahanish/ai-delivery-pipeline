import type { Metadata } from "next";
import type { ReactNode } from "react";
import { auth, signOut } from "../auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Delivery Pipeline — Backlog",
  description: "Submit backlog items; each one becomes a JIRA story automatically.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  return (
    <html lang="en">
      <body>
        {session?.user ? (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: 12,
              padding: "10px 20px",
              borderBottom: "1px solid var(--border)",
              fontSize: 13,
              color: "var(--muted)",
            }}
          >
            <span>
              {session.user.githubLogin} ·{" "}
              <span className={`badge role-${session.user.role ?? "viewer"}`}>{session.user.role ?? "viewer"}</span>
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/signin" });
              }}
            >
              <button type="submit" className="button secondary">
                Sign out
              </button>
            </form>
          </div>
        ) : null}
        {children}
      </body>
    </html>
  );
}
