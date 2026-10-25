import { AGREEMENT_SECTIONS, AGREEMENT_UPDATED, AGREEMENT_VERSION } from '../lib/tournamentAgreement.js';
import { PageHeader } from '../components/ui.jsx';

export function AgreementText() {
  return (
    <div className="agreement">
      {AGREEMENT_SECTIONS.map((s) => (
        <section key={s.title}>
          <h3>{s.title}</h3>
          {s.body.map((p) => <p key={p.slice(0, 40)}>{p}</p>)}
        </section>
      ))}
    </div>
  );
}

export default function TournamentAgreementPage() {
  return (
    <div className="narrow">
      <PageHeader title="PartyUp Tournament Agreement" sub={`Version ${AGREEMENT_VERSION} · Updated ${AGREEMENT_UPDATED}`} />
      <AgreementText />
    </div>
  );
}
