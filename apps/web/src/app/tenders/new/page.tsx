import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "../../../components/ui/icon.tsx";
import { getConfig } from "../../../lib/near/views.ts";
import { CreateTenderForm } from "../../../components/app/create-tender-form.tsx";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create a tender",
  robots: { index: false, follow: false },
};

export default async function NewTenderPage() {
  let nextId: number | null = null;
  let error: string | null = null;
  try {
    nextId = (await getConfig()).next_tender_id;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error || nextId === null) {
    return (
      <div className="page-error" role="alert">
        <h2>The chain could not be read</h2>
        <p>{error}</p>
        <p>
          A tender cannot be prepared without it: the committee keys are bound
          to the id the contract will assign next, which has to be read from the
          contract.
        </p>
      </div>
    );
  }

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/tenders">Tenders</Link>
        <Icon name="chevron" size={15} />
        <span aria-current="page">Create tender</span>
      </nav>
      <div className="page-head">
        <h1>Create a tender</h1>
        <p>
          Set the brief, decide how bids will be scored, and choose your
          committee. You will review everything before publishing.
        </p>
      </div>
      <CreateTenderForm initialNextId={nextId} />
    </>
  );
}
