import { celebrate } from '../lib/confetti.js';
import { useMemo, useState } from 'react';
import { LuTrophy, LuShieldCheck } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useApp } from '../context/AppContext.jsx';
import { navigate } from '../lib/router.jsx';
import { gameOptions, REGIONS, PLATFORMS } from '../lib/constants.js';
import { AGREEMENT_VERSION } from '../lib/tournamentAgreement.js';
import { Button, Field, Input, InlineError, Modal, PageHeader, Panel, Segmented, Select, Textarea } from '../components/ui.jsx';
import { useToast } from '../components/feedback.jsx';
import { AgreementText } from './TournamentAgreementPage.jsx';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'BRL', 'MXN', 'JPY', 'INR', 'PHP'].map((c) => ({ value: c, label: c }));
const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export default function CreateTournamentPage() {
  const { communities } = useApp();
  const toast = useToast();
  const games = useAsync(() => api.getGames(), []);
  const [f, setF] = useState(() => {
    const d = new Date(Date.now() + 2 * 86400000); d.setMinutes(0, 0, 0); d.setHours(19);
    return {
      game_id: null, title: '', starts_at: toLocalInput(d), max_entrants: '8', team_size: '1', region: null, platform: null,
      description: '', rules: '', prize_type: 'none', prize_total: '', prize_currency: 'USD', split: ['', '', ''],
      prize_description: '', payout_method: '', payout_deadline_days: '7', host_contact: '', community_id: null,
    };
  });
  const [agreed, setAgreed] = useState(false);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));
  const money = f.prize_type === 'cash' || f.prize_type === 'gift_card';
  const splitSum = f.split.reduce((a, b) => a + (Number(b) || 0), 0);
  const total = Number(f.prize_total) || 0;
  const game = useMemo(() => games.data?.find((g) => g.id === f.game_id), [games.data, f.game_id]);

  const suggest = () => {
    if (!total) return;
    const a = Math.round(total * 0.6 * 100) / 100; const b = Math.round(total * 0.3 * 100) / 100;
    setF((s) => ({ ...s, split: [String(a), String(b), String(Math.round((total - a - b) * 100) / 100)] }));
  };

  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (!f.game_id) return setErr(new Error('Pick a game.'));
    if (!agreed) return setErr(new Error('Read and accept the Tournament Agreement to host.'));
    if (money && Math.abs(splitSum - total) > 0.001) return setErr(new Error(`The prize split (${splitSum}) must add up to the prize pool (${total}).`));
    setBusy(true);
    try {
      const prize_split = money ? f.split.map((a, i) => ({ place: i + 1, amount: Number(a) || 0 })).filter((x) => x.amount > 0) : [];
      const id = await api.createTournament({ ...f, starts_at: new Date(f.starts_at).toISOString(), prize_split, agreement_version: AGREEMENT_VERSION });
      toast('Tournament created 🏆'); celebrate();
      navigate(`/tournaments/${id}`, { replace: true });
    } catch (ex) { setErr(ex); setBusy(false); }
  };

  return (
    <div className="narrow">
      <PageHeader title="Host a tournament" sub="Single-elimination bracket. Free to enter — you can offer a prize you'll pay yourself." />
      <form onSubmit={submit} className="stack-l">
        <Panel title="Basics">
          <div className="form-body">
            <Field label="Game" htmlFor="t-game"><Select id="t-game" options={gameOptions(games.data)} value={f.game_id} onChange={set('game_id')} placeholder="Choose a game" /></Field>
            <Field label="Title" htmlFor="t-title"><Input id="t-title" maxLength={80} value={f.title} onChange={set('title')} placeholder={game ? `${game.short_name || game.name} Friday Night Cup` : 'Friday Night Cup'} /></Field>
            <div className="field-pair">
              <Field label="Starts" htmlFor="t-start"><Input id="t-start" type="datetime-local" value={f.starts_at} onChange={set('starts_at')} /></Field>
              <Field label="Bracket size"><Segmented ariaLabel="Bracket size" value={f.max_entrants} onChange={set('max_entrants')} options={['4', '8', '16', '32', '64'].map((v) => ({ value: v, label: v }))} /></Field>
            </div>
            <div className="field-pair">
              <Field label="Team size"><Segmented ariaLabel="Team size" value={f.team_size} onChange={set('team_size')} options={['1', '2', '3', '4', '5', '6'].map((v) => ({ value: v, label: v === '1' ? 'Solo' : `${v}v${v}` }))} /></Field>
              <Field label="Region" optional><Select options={REGIONS} value={f.region} onChange={set('region')} placeholder="Any region" aria-label="Region" /></Field>
            </div>
            <div className="field-pair">
              <Field label="Platform" optional><Select options={[...PLATFORMS, { value: 'crossplay', label: 'Crossplay' }]} value={f.platform} onChange={set('platform')} placeholder="Any platform" aria-label="Platform" /></Field>
              <Field label="Community" optional hint="Link it to a community you're in."><Select options={(communities || []).map((c) => ({ value: c.id, label: c.name }))} value={f.community_id} onChange={set('community_id')} placeholder="None" aria-label="Community" /></Field>
            </div>
            <Field label="Description" optional htmlFor="t-desc"><Textarea id="t-desc" rows={3} maxLength={2000} value={f.description} onChange={set('description')} placeholder="What's this tournament about?" /></Field>
            <Field label="Rules" optional htmlFor="t-rules" hint="Map pool, best-of, how to report results, what counts as a no-show."><Textarea id="t-rules" rows={5} maxLength={4000} value={f.rules} onChange={set('rules')} /></Field>
          </div>
        </Panel>

        <Panel title="Prize">
          <div className="form-body">
            <Segmented ariaLabel="Prize type" value={f.prize_type} onChange={set('prize_type')} options={[
              { value: 'none', label: 'No prize' }, { value: 'cash', label: 'Cash' }, { value: 'gift_card', label: 'Gift card' },
              { value: 'item', label: 'Item' }, { value: 'other', label: 'Other' },
            ]} />
            {f.prize_type === 'none' && <p className="muted small">Bragging rights only. You can still crown a champion.</p>}
            {money && (
              <>
                <div className="field-pair">
                  <Field label="Total prize pool" htmlFor="t-total"><Input id="t-total" type="number" min="1" step="0.01" value={f.prize_total} onChange={set('prize_total')} /></Field>
                  <Field label="Currency"><Select options={CURRENCIES} value={f.prize_currency} onChange={set('prize_currency')} aria-label="Currency" /></Field>
                </div>
                <Field label="Split" hint={`Adds up to ${splitSum || 0} of ${total || 0}. 3rd place is shared by both semifinal losers.`}>
                  <div className="split-row">
                    {['1st', '2nd', '3rd'].map((label, i) => (
                      <label key={label} className="split-cell"><span>{label}</span>
                        <Input type="number" min="0" step="0.01" value={f.split[i]} aria-label={`${label} place prize`}
                          onChange={(e) => setF((s) => ({ ...s, split: s.split.map((x, j) => (j === i ? e.target.value : x)) }))} /></label>
                    ))}
                    <Button size="sm" variant="ghost" onClick={suggest} disabled={!total}>60 / 30 / 10</Button>
                  </div>
                </Field>
                <div className="field-pair">
                  <Field label="How winners get paid" htmlFor="t-payout"><Input id="t-payout" maxLength={200} value={f.payout_method} onChange={set('payout_method')} placeholder="e.g. PayPal, Steam gift card code" /></Field>
                  <Field label="Paid within (days)" htmlFor="t-days"><Input id="t-days" type="number" min="1" max="60" value={f.payout_deadline_days} onChange={set('payout_deadline_days')} /></Field>
                </div>
              </>
            )}
            {f.prize_type !== 'none' && (
              <Field label="Prize details" optional={money} htmlFor="t-prize"><Input id="t-prize" maxLength={500} value={f.prize_description} onChange={set('prize_description')} placeholder={money ? 'Anything else winners should know' : 'e.g. Signed mousepad, shipped worldwide'} /></Field>
            )}
            <Field label="Contact" optional htmlFor="t-contact" hint="How entrants can reach you besides PartyUp DMs."><Input id="t-contact" maxLength={120} value={f.host_contact} onChange={set('host_contact')} /></Field>
            {money && <p className="notice-inline"><LuShieldCheck aria-hidden /> Accounts must be at least 3 days old to offer cash or gift cards. Winners confirm payment on the tournament page, and unpaid prizes are reported to moderators automatically.</p>}
          </div>
        </Panel>

        <Panel title="Tournament Agreement">
          <div className="form-body">
            <p className="muted small">Hosts and players all accept the same agreement: no entry fees or betting, hosts alone pay prizes, fair play, and moderators can act on scams.</p>
            <label className="agree-row">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>I've read and agree to the <button type="button" className="link-btn" onClick={() => setReading(true)}>PartyUp Tournament Agreement</button>, and I'll deliver any prize I offer.</span>
            </label>
          </div>
        </Panel>
        <InlineError error={err} />
        <div className="row gap-s">
          <Button type="submit" variant="primary" size="lg" icon={LuTrophy} loading={busy}>Create tournament</Button>
          <Button variant="ghost" onClick={() => navigate('/tournaments')}>Cancel</Button>
        </div>
      </form>
      {reading && (
        <Modal open onClose={() => setReading(false)} title="Tournament Agreement" size="lg"
          footer={<Button variant="primary" onClick={() => { setAgreed(true); setReading(false); }}>I agree</Button>}>
          <AgreementText />
        </Modal>
      )}
    </div>
  );
}
