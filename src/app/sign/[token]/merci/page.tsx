import Link from "next/link";
import { Check } from "lucide-react";
import { notFound } from "next/navigation";
import { getPublicSignSession } from "@/app/actions/signature-public";
import { EnsureNextInvite } from "@/components/EnsureNextInvite";
import { MegaLogo } from "@/components/MegaLogo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function PublicSignMerciPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await getPublicSignSession(token);
  if (!session) notFound();

  return (
    <div className="flex min-h-dvh w-full flex-col bg-[#f3f4f6]">
      {session.alreadySigned && <EnsureNextInvite token={token} />}
      <header className="flex h-14 w-full items-center gap-3 border-b border-slate-200 bg-white px-4">
        <MegaLogo width={108} />
        <span className="mx-auto truncate text-sm font-medium text-slate-700">
          {session.titre}
        </span>
      </header>

      <main className="flex w-full flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-600">
          <Check className="h-9 w-9 text-white" strokeWidth={3} />
        </div>
        <h1 className="mt-6 text-3xl font-semibold text-slate-900">
          You&apos;re all set!
        </h1>
        <p className="mt-3 text-slate-600">
          You finished signing &apos;{session.titre}&apos;.
        </p>
        <p className="mt-2 max-w-md text-sm text-slate-500">
          We will send the final agreement to all parties. You can also{" "}
          <a
            href={session.signedPdfUrl}
            className="font-medium text-blue-600 underline"
            target="_blank"
            rel="noreferrer"
          >
            download a copy
          </a>{" "}
          of what you just signed.
        </p>

        <div className="mt-10 max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-800">
            Manage your MEGA Signature agreements
          </h2>
          <Link
            href="/login"
            className="mt-4 inline-flex rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Sign In
          </Link>
        </div>
      </main>
    </div>
  );
}
