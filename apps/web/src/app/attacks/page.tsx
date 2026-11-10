import Link from "next/link";
import { ATTACKS } from "../../config/attacks.ts";
import { AttackRecords } from "../../components/app/attack-records.tsx";
import { AttackReplay } from "../../components/app/attack-replay.tsx";
import { Icon } from "../../components/ui/icon.tsx";

export const metadata = { title: "Recorded attack attempts" };

export default function AttacksPage() {
  const flagged = ATTACKS.records.filter((record) => record.layer === "evaluator").length;
  return (
    <div className="attacks-page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/tenders">Tenders</Link><Icon name="chevron" size={15} /><span aria-current="page">Attack evidence</span>
      </nav>
      <header className="page-head attack-intro">
        <span className="page-eyebrow ui-reference">Recorded on {ATTACKS.network}</span>
        <h1>Test the boundaries. Inspect the evidence.</h1>
        <p>See what happened when we tried to read sealed bids, change the rules and redirect a payout. Every attempt links to its recorded transaction.</p>
        <div className="page-head-actions">
          <Link className="ui-button ui-button--primary" href={`/tenders/${ATTACKS.tender_id}/verify`}>Verify this tender <Icon name="arrow" size={17} /></Link>
          <a className="ui-button ui-button--ghost" href="#attack-live-title">Run an attempt <Icon name="down" size={17} /></a>
        </div>
      </header>
      <dl className="attack-summary ui-paper">
        <div><dt>Recorded attempts</dt><dd>{ATTACKS.records.length}</dd></div>
        <div><dt>Calls refused</dt><dd>{ATTACKS.records.length - flagged}<Icon name="shield" size={21} /></dd></div>
        <div><dt>Flagged for review</dt><dd>{flagged}<Icon name="warning" size={21} /></dd></div>
        <div className="attack-summary-record"><dt>Evidence source</dt><dd><Link className="inline-link" href={`/tenders/${ATTACKS.tender_id}`}>Tender #{ATTACKS.tender_id}<Icon name="arrow" size={16} /></Link><span>{ATTACKS.recorded_at.slice(0, 10)} UTC</span></dd></div>
      </dl>
      <div className="attack-caveat" role="note">
        <Icon name="info" size={20} /><p><strong>A flag is a request for human review.</strong> Prompt injection was flagged, but the bid remained eligible. This run does not establish that every model resisted the instruction.</p>
      </div>
      <AttackRecords records={ATTACKS.records} />
      <section className="panel ui-paper attack-limits" aria-labelledby="attack-limits-title">
        <div className="award-section-label"><Icon name="info" size={18} /><span>Understand the limits</span></div>
        <h2 id="attack-limits-title">What these results establish</h2>
        <p>The caller, time, ciphertext, committee and winner checks refused these calls. An injection flag does not make a bid ineligible or lower its score. Model judgments can vary; the committee reviews the text before deciding.</p>
        <details className="attack-evidence">
          <summary>Deployment details and untested risks <Icon name="down" size={16} /></summary>
          <p>These outcomes were recorded on <span className="mono">{ATTACKS.contract_id}</span>. Contract and secret-row owner keys remain active. Their holders can replace the contract or rebind the secret.</p>
          <p>Attempt 2, a different evaluator build, is covered by earlier gate evidence and was not rerun here. These outcomes do not cover collusion, false claims, a biased rubric or compromised owner keys.</p>
        </details>
      </section>
      <AttackReplay records={ATTACKS.records} />
    </div>
  );
}
