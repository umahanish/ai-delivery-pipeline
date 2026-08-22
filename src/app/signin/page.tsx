import { signIn } from "../../auth";

// No open self-signup: a valid GitHub account gets you to the OAuth
// consent screen, but src/auth.ts's signIn callback still refuses
// anyone not already in authorized_users -- this page can't promise
// access, only offer the one way in.
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  return (
    <main style={{ maxWidth: 420, textAlign: "center", paddingTop: 96 }}>
      <h1>AI Delivery Pipeline</h1>
      <p style={{ color: "var(--muted)" }}>
        Sign in with GitHub to submit or manage backlog items. Access is
        allowlisted — a GitHub account alone isn&apos;t enough; ask an
        existing maintainer to add your username first.
      </p>
      <form
        action={async () => {
          "use server";
          await signIn("github", { redirectTo: callbackUrl ?? "/" });
        }}
      >
        <button type="submit">Sign in with GitHub</button>
      </form>
    </main>
  );
}
