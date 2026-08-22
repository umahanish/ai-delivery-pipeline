import { redirect } from "next/navigation";
import { auth } from "../../auth";
import NewBacklogItemForm from "./NewBacklogItemForm";

// Server component gate in front of the client form -- submitBacklogItemAction
// already refuses a non-maintainer server-side (defense in depth), but a
// viewer landing on a form they can't actually use is bad UX, not a
// security gap on its own.
export default async function NewBacklogItemPage() {
  const session = await auth();
  if (session?.user.role !== "maintainer") {
    redirect("/");
  }

  return <NewBacklogItemForm />;
}
