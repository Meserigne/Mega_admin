import {
  listMyEnvelopes,
  listTrashedEnvelopes,
} from "@/app/actions/signature-docs";
import { SignatureHomeClient } from "@/components/SignatureHomeClient";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SignaturesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [envelopes, trash] = await Promise.all([
    listMyEnvelopes(),
    listTrashedEnvelopes(),
  ]);

  return <SignatureHomeClient envelopes={envelopes} trash={trash} />;
}
