import { LuCrown, LuMic, LuCalendar, LuLock, LuGlobe } from 'react-icons/lu';
import { Link } from '../lib/router.jsx';
import { regionLabel, languageLabel } from '../lib/constants.js';
import { sessionTime } from '../lib/format.js';
import { Avatar, CompatButton, GameTag, PartyStatus, Pips } from './gaming.jsx';
import { DemoBadge } from './ui.jsx';

const REL = { leader: 'You lead this', member: "You're in", invited: "You're invited", requested: 'Request pending' };

export default function PartyCard({ party, showFit = true }) {
  const rank = party.min_rank || party.max_rank ? `${party.min_rank || 'Any'} – ${party.max_rank || 'Any'}` : null;
  return (
    <article className="party-card" style={{ '--gc': party.game?.accent_color }}>
      <Link to={`/parties/${party.id}`} className="party-link" aria-label={`${party.title}, ${party.game.name}`} />
      <div className="party-top">
        <GameTag game={party.game} />
        <span className="row gap-s">
          {showFit && party.fit && party.my_relation === 'none' && <CompatButton compat={party.fit} label="Fit for you" />}
          <PartyStatus status={party.status} />
        </span>
      </div>
      <h3 className="party-title">{party.title}</h3>
      {party.description && <p className="party-desc">{party.description}</p>}
      <div className="party-slots">
        <Pips filled={party.member_count} total={party.max_size} />
        <span>{party.member_count}/{party.max_size}{party.open_slots > 0 && party.status === 'open' ? `, ${party.open_slots} open` : ''}</span>
      </div>
      {party.needed_roles?.length > 0 && party.status === 'open' && (
        <div className="needed">Needs {party.needed_roles.map((r) => <span key={r} className="role-chip">{r}</span>)}</div>
      )}
      <ul className="party-meta">
        <li className={`ptype ptype-${party.play_type}`}>{party.play_type === 'competitive' ? 'Competitive' : 'Casual'}</li>
        {rank && <li>{rank}</li>}
        {party.language && <li>{languageLabel(party.language)}</li>}
        {party.region && <li>{regionLabel(party.region)}</li>}
        {party.mic_required && <li><LuMic aria-hidden />Mic required</li>}
        {party.scheduled_for && <li><LuCalendar aria-hidden />{sessionTime(party.scheduled_for)}</li>}
        <li>{party.visibility === 'public' ? <><LuGlobe aria-hidden />Public</> : <><LuLock aria-hidden />Invite only</>}</li>
      </ul>
      <div className="party-foot">
        <span className="leader">
          {party.leader && <Avatar user={party.leader} size={22} />}
          <LuCrown aria-hidden className="crown" />{party.leader?.username || 'Leader'}
          {party.is_demo && <DemoBadge />}
        </span>
        {REL[party.my_relation] && <span className="rel">{REL[party.my_relation]}</span>}
      </div>
    </article>
  );
}
