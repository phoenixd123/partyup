import {
  LuUserPlus, LuUserCheck, LuUserMinus, LuClock, LuMessageCircle, LuUsers, LuFlag, LuBan, LuVolumeX, LuVolume2,
  LuEllipsis, LuMapPin, LuTrophy, LuPencil, LuUserX,
} from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useApp } from '../context/AppContext.jsx';
import { navigate } from '../lib/router.jsx';
import {
  regionLabel, languageLabel, PLAYSTYLES, TEAMMATE_TRAITS, TEAMMATE_MIC, LOOKING_FOR, EXPERIENCE, SESSION_LENGTHS, label,
} from '../lib/constants.js';
import { memberSince } from '../lib/format.js';
import { Badge, Button, DemoBadge, EmptyState, ErrorState, Menu, PageLoader, Panel, IconButton } from '../components/ui.jsx';
import { Avatar, CompatBreakdown, GameTag, MicLabel, PlatformIcon, Presence, SignalMeter, MatchingWeights } from '../components/gaming.jsx';
import { usePlayerActions } from '../components/PlayerActions.jsx';
import AvailabilityGrid from '../components/AvailabilityGrid.jsx';

export default function PlayerProfilePage({ params }) {
  const { profile: me } = useApp();
  const { data: p, error, loading, reload } = useAsync(() => api.getPlayerProfile(params.id), [params.id]);
  const actions = usePlayerActions(p || { id: params.id }, () => reload({ quiet: true }));

  if (loading && !p) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!p) {
    return <EmptyState icon={LuUserX} title="Player not found" action={<Button onClick={() => navigate('/players')}>Find players</Button>}>
      This profile doesn't exist, isn't available, or the player has blocked you.</EmptyState>;
  }
  if (p.blocked_by_me) {
    return (
      <EmptyState icon={LuBan} title={`You blocked ${p.username}`} action={<Button onClick={actions.unblock} loading={actions.pending === 'block'}>Unblock</Button>}>
        Unblock them to see their profile. They can't contact you while blocked.
      </EmptyState>
    );
  }
  const rel = p.relationship;

  return (
    <div className="profile">
      <section className="profile-hero">
        <Avatar user={p} size={96} status={p.status} />
        <div className="profile-id">
          <h1>{p.username} {p.is_demo && <DemoBadge />}</h1>
          <div className="row gap-m wrap muted">
            <Presence user={p} />
            {p.region && <span><LuMapPin aria-hidden /> {regionLabel(p.region)}</span>}
            <span>Joined {memberSince(p.created_at)}</span>
            <span>{p.friend_count} friends</span>
          </div>
          {p.is_demo && <p className="muted small">Sample profile for development. Requests and messages to demo players won't get a reply.</p>}
        </div>
        <div className="profile-actions">
          {p.is_self ? (
            <Button icon={LuPencil} onClick={() => navigate('/settings/profile')}>Edit profile</Button>
          ) : (
            <>
              {rel === 'friends' ? <Button icon={LuUserCheck} onClick={actions.removeFriend}>Friends</Button>
                : rel === 'outgoing' ? <Button icon={LuClock} onClick={actions.removeFriend}>Requested</Button>
                : rel === 'incoming' ? <Button variant="primary" icon={LuUserCheck} onClick={actions.accept} loading={actions.pending === 'friend'}>Accept request</Button>
                : p.can_friend ? <Button variant="primary" icon={LuUserPlus} onClick={actions.addFriend} loading={actions.pending === 'friend'}>Add Friend</Button>
                : <Button icon={LuUserPlus} disabled title="Not accepting friend requests">Add Friend</Button>}
              <Button icon={LuMessageCircle} onClick={actions.message} loading={actions.pending === 'message'} disabled={!p.can_message}
                title={p.can_message ? undefined : 'This player only accepts messages from friends'}>Message</Button>
              <Button icon={LuUsers} onClick={actions.invite} disabled={!p.can_invite} title={p.can_invite ? undefined : 'Not accepting party invites from you'}>Invite to Party</Button>
              <Menu trigger={({ toggle, open }) => <IconButton icon={LuEllipsis} label="More actions" onClick={toggle} aria-expanded={open} />}
                items={[
                  { label: 'Remove friend', icon: LuUserMinus, onClick: actions.removeFriend, hidden: rel !== 'friends' },
                  { label: p.muted_by_me ? 'Unmute' : 'Mute', icon: p.muted_by_me ? LuVolume2 : LuVolumeX, onClick: actions.mute },
                  { label: 'Block', icon: LuBan, onClick: actions.block, danger: true },
                  { label: 'Report Player', icon: LuFlag, onClick: actions.report, danger: true },
                ]} />
            </>
          )}
        </div>
      </section>

      <div className="profile-grid">
        <div className="profile-main">
          {p.bio && <Panel title="About"><p className="bio">{p.bio}</p></Panel>}

          <Panel title="Games">
            {p.game_profiles.length === 0 ? <p className="muted pad">No games listed.</p> : (
              <div className="gp-list">
                {p.game_profiles.map((g) => (
                  <article key={g.id} className="gp-card" style={{ '--gc': g.accent_color }}>
                    <div className="gp-head">
                      <GameTag game={g} />
                      {g.compatibility && <SignalMeter score={g.compatibility.score} label={`${g.name} compatibility`} />}
                    </div>
                    <dl className="gp-facts">
                      {g.rank && <><dt>Rank</dt><dd>{g.rank} <Badge title="Ranks are entered by players and not verified">Self-reported</Badge></dd></>}
                      {g.main_role && <><dt>Main role</dt><dd>{g.main_role}{g.secondary_roles?.length ? `, also ${g.secondary_roles.join(', ')}` : ''}</dd></>}
                      <dt>Experience</dt><dd>{label(EXPERIENCE, g.experience)}</dd>
                      {g.platform && <><dt>Platform</dt><dd><PlatformIcon platform={g.platform} /></dd></>}
                      {g.preferred_modes?.length > 0 && <><dt>Modes</dt><dd>{g.preferred_modes.join(', ')}</dd></>}
                      {g.session_length && <><dt>Sessions</dt><dd>{label(SESSION_LENGTHS, g.session_length)}</dd></>}
                      <dt>Looking for</dt><dd>{label(LOOKING_FOR, g.looking_for)}</dd>
                      {g.playstyles?.length > 0 && <><dt>Style</dt><dd>{g.playstyles.map((s) => label(PLAYSTYLES, s)).join(', ')}</dd></>}
                    </dl>
                    {g.notes && <p className="gp-notes">{g.notes}</p>}
                  </article>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Usual playtimes">
            {p.availability?.length ? (
              <AvailabilityGrid value={p.availability} readOnly compare={p.is_self ? null : me.availability} />
            ) : <p className="muted pad">{p.is_self ? 'Add playtimes in Settings.' : 'Not shared.'}</p>}
          </Panel>
        </div>

        <aside className="profile-side">
          {!p.is_self && p.compatibility && (
            <Panel title="Compatibility with you">
              <CompatBreakdown compat={p.compatibility} title={p.compatibility.game_id ? `Best shared game: ${p.game_profiles.find((g) => g.game_id === p.compatibility.game_id)?.name}` : 'Based on your profiles'} />
              <MatchingWeights />
            </Panel>
          )}
          <Panel title="Plays">
            <dl className="facts">
              {p.languages?.length > 0 && <><dt>Languages</dt><dd>{p.languages.map(languageLabel).join(', ')}</dd></>}
              {p.platforms?.length > 0 && <><dt>Platforms</dt><dd className="row gap-s wrap">{p.platforms.map((x) => <PlatformIcon key={x} platform={x} />)}</dd></>}
              {p.mic_preference && <><dt>Voice</dt><dd><MicLabel mic={p.mic_preference} /></dd></>}
              <dt>Looking for</dt><dd>{label(LOOKING_FOR, p.looking_for)}</dd>
              {p.playstyles?.length > 0 && <><dt>Playstyle</dt><dd className="chips static">{p.playstyles.map((s) => <span key={s} className="chip">{label(PLAYSTYLES, s)}</span>)}</dd></>}
            </dl>
          </Panel>
          {(p.teammate_traits?.length > 0 || p.pref_teammate_mic !== 'any') && (
            <Panel title="Wants teammates who">
              <div className="chips static pad">
                {p.teammate_traits.map((t) => <span key={t} className="chip">{label(TEAMMATE_TRAITS, t)}</span>)}
                {p.pref_teammate_mic !== 'any' && <span className="chip">{label(TEAMMATE_MIC, p.pref_teammate_mic)}</span>}
              </div>
            </Panel>
          )}
          <Panel title="Achievements">
            {p.achievements.length === 0 ? <p className="muted small pad">None earned yet. Achievements come from real activity on PartyUp.</p> : (
              <ul className="achievements">
                {p.achievements.map((a) => <li key={a.key}><LuTrophy aria-hidden /><span><strong>{a.label}</strong><small>{a.description}</small></span></li>)}
              </ul>
            )}
            {p.highlights?.length > 0 && (
              <>
                <h3 className="sub-h">Highlights <Badge>Self-reported</Badge></h3>
                <ul className="highlights">{p.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
              </>
            )}
          </Panel>
        </aside>
      </div>
      {actions.dialogs}
    </div>
  );
}
