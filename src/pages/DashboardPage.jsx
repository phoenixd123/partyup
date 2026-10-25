import { useEffect, useState } from 'react';
import { LuZap, LuSearch, LuPlus, LuUsers, LuUserPlus, LuMailOpen, LuGamepad2, LuCrown, LuLightbulb, LuShuffle, LuX } from 'react-icons/lu';
import { greeting, heroLine, randomLine } from '../lib/flavor.js';
import { Pumpkin, useSeason } from '../components/Seasonal.jsx';
import * as api from '../lib/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useApp } from '../context/AppContext.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { timeAgo, plural } from '../lib/format.js';
import { Button, EmptyState, ErrorState, Panel, Skeleton, SkeletonCards } from '../components/ui.jsx';
import { Avatar, GameTag, Pips, PartyStatus, StatusDot } from '../components/gaming.jsx';
import { useToast } from '../components/feedback.jsx';
import PlayerCard from '../components/PlayerCard.jsx';
import PartyCard from '../components/PartyCard.jsx';
import { describe } from '../components/NotificationList.jsx';

const MISSING = {
  games: ['Add a game', '/games'], region: ['Set your region', '/settings/profile'], languages: ['Add languages', '/settings/profile'],
  availability: ['Add your playtimes', '/settings/availability'], mic: ['Set mic preference', '/settings/profile'], bio: ['Write a short bio', '/settings/profile'],
};

export default function DashboardPage() {
  const { profile, onNotify, refreshCounts } = useApp();
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api.getDashboard(), []);
  useEffect(() => onNotify(() => reload({ quiet: true })), [onNotify, reload]);

  const season = useSeason();
  const [hello] = useState(() => greeting(profile.username));
  const [sub] = useState(() => heroLine());
  const [note, setNote] = useState(() => randomLine());
  const [bannerHidden, setBannerHidden] = useState(() => { try { return localStorage.getItem('partyup.banner.halloween-2026') === '1'; } catch { return false; } });
  const hideBanner = () => { setBannerHidden(true); try { localStorage.setItem('partyup.banner.halloween-2026', '1'); } catch { /* ignore */ } };

  const act = async (fn, msg) => {
    try { await fn(); toast(msg); reload({ quiet: true }); refreshCounts(); } catch (e) { toast(e, 'error'); }
  };

  return (
    <div className="dash">
      <section className="dash-hero">
        <div>
          <h1>{hello}</h1>
          <p className="sub">{sub}</p>
        </div>
        <div className="dash-cta">
          <Button variant="primary" size="lg" icon={LuZap} onClick={() => navigate('/match')}>Find Teammates</Button>
          <Button size="lg" icon={LuPlus} onClick={() => navigate('/parties/new')}>Create party</Button>
        </div>
      </section>

      {season === 'halloween' && !bannerHidden && (
        <div className="season-banner">
          <Pumpkin size={34} />
          <p><b>Spooky season is live.</b> Horror nights are better with a squad — try a Phasmophobia, Lethal Company or Dead by Daylight party.</p>
          <Button size="sm" onClick={() => navigate('/parties')}>Browse parties</Button>
          <Button size="sm" variant="ghost" icon={LuX} aria-label="Dismiss" onClick={hideBanner} />
        </div>
      )}

      {error ? <ErrorState error={error} onRetry={reload} /> : (
        <>
          {data?.missing_profile?.length > 0 && (
            <div className="complete-bar">
              <span>Better matches start with a fuller profile.</span>
              <span className="row gap-s wrap">
                {data.missing_profile.map((k) => MISSING[k] && <Button key={k} size="sm" variant="ghost" onClick={() => navigate(MISSING[k][1])}>{MISSING[k][0]}</Button>)}
              </span>
            </div>
          )}

          <div className="dash-grid">
            <div className="dash-main">
              <Panel title="Recommended teammates" action={<Link to="/players" className="small">See all</Link>}>
                {loading && !data ? <SkeletonCards count={3} /> : data.recommended_players.length === 0 ? (
                  <EmptyState icon={LuSearch} title="No recommendations yet"
                    action={<Button icon={LuGamepad2} onClick={() => navigate('/games')}>Add a game profile</Button>}>
                    We recommend players who share your games. Add the games you play, or check back as more players join.
                  </EmptyState>
                ) : (
                  <div className="card-grid">{data.recommended_players.slice(0, 4).map((p) => <PlayerCard key={p.id} player={p} onChanged={() => reload({ quiet: true })} />)}</div>
                )}
              </Panel>

              <Panel title="Suggested sessions" action={<Link to="/parties" className="small">Browse parties</Link>}>
                {loading && !data ? <SkeletonCards count={2} h={170} /> : data.suggested_parties.length === 0 ? (
                  <EmptyState icon={LuUsers} title="No open parties right now"
                    action={<Button variant="primary" icon={LuPlus} onClick={() => navigate('/parties/new')}>Create a party</Button>}>
                    Be the first — create a public party and players can ask to join.
                  </EmptyState>
                ) : (
                  <div className="card-grid two">{data.suggested_parties.map((p) => <PartyCard key={p.id} party={p} />)}</div>
                )}
              </Panel>
            </div>

            <aside className="dash-side">
              <Panel title="Did you know?" action={<Button size="sm" variant="ghost" icon={LuShuffle} aria-label="Another one" onClick={() => setNote(randomLine())} />}>
                <div className="note-card"><span className="note-ico"><LuLightbulb aria-hidden /></span><p>{note}</p></div>
              </Panel>
              {data?.party_invites?.length > 0 && (
                <Panel title="Party invites" className="accent">
                  <ul className="mini-list">
                    {data.party_invites.map((i) => (
                      <li key={i.id}>
                        <Link to={`/parties/${i.party.id}`} className="grow mini-link">
                          <strong>{i.party.title}</strong>
                          <span className="row gap-s"><GameTag game={i.party.game} compact /><span className="muted small">from {i.inviter?.username}</span></span>
                        </Link>
                        <span className="row gap-xs">
                          <Button size="sm" variant="primary" onClick={() => act(() => api.respondInvite(i.id, true), `Joined ${i.party.title}`)}>Join</Button>
                          <Button size="sm" variant="ghost" onClick={() => act(() => api.respondInvite(i.id, false), 'Invite declined')}>Decline</Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              {data?.friend_requests?.length > 0 && (
                <Panel title="Friend requests" action={<Link to="/friends?tab=requests" className="small">All</Link>}>
                  <ul className="mini-list">
                    {data.friend_requests.slice(0, 4).map((u) => (
                      <li key={u.id}>
                        <Link to={`/players/${u.id}`} className="row gap-s grow mini-link"><Avatar user={u} size={32} /><span><strong>{u.username}</strong><span className="muted small block">{timeAgo(u.requested_at)}</span></span></Link>
                        <span className="row gap-xs">
                          <Button size="sm" variant="primary" onClick={() => act(() => api.respondFriendRequest(u.id, true), `You and ${u.username} are now friends`)}>Accept</Button>
                          <Button size="sm" variant="ghost" onClick={() => act(() => api.respondFriendRequest(u.id, false), 'Request declined')}>Decline</Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              <Panel title="Your parties" action={<Link to="/parties?tab=mine" className="small">Manage</Link>}>
                {loading && !data ? <Skeleton h={60} /> : data.my_parties.length === 0 ? (
                  <p className="muted small pad">You're not in a party. <Link to="/parties">Browse</Link> or <Link to="/parties/new">create one</Link>.</p>
                ) : (
                  <ul className="mini-list">
                    {data.my_parties.map((p) => (
                      <li key={p.id}>
                        <Link to={`/parties/${p.id}`} className="grow mini-link">
                          <strong>{p.my_relation === 'leader' && <LuCrown aria-label="You lead" className="crown" />} {p.title}</strong>
                          <span className="row gap-s"><GameTag game={p.game} compact /><Pips filled={p.member_count} total={p.max_size} /><PartyStatus status={p.status} /></span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {data?.pending_join_requests > 0 && (
                  <p className="pad small"><LuMailOpen aria-hidden /> {plural(data.pending_join_requests, 'join request')} waiting on your parties.</p>
                )}
              </Panel>

              <Panel title="Friends online" action={<Link to="/friends" className="small">Friends</Link>}>
                {loading && !data ? <Skeleton h={40} /> : data.friends_online.length === 0 ? (
                  <p className="muted small pad">No friends online right now.{' '}
                    <Button variant="link" size="sm" icon={LuUserPlus} onClick={() => navigate('/players')}>Find players</Button></p>
                ) : (
                  <ul className="mini-list">
                    {data.friends_online.map((u) => (
                      <li key={u.id}><Link to={`/players/${u.id}`} className="row gap-s grow mini-link"><Avatar user={u} size={30} status={u.status} /><strong>{u.username}</strong></Link></li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="Recent activity" action={<Link to="/notifications" className="small">All</Link>}>
                {loading && !data ? <Skeleton h={80} /> : data.recent_activity.length === 0 ? (
                  <p className="muted small pad">Nothing yet. Requests, invites and messages will show up here.</p>
                ) : (
                  <ul className="activity">
                    {data.recent_activity.map((n) => {
                      const d = describe(n);
                      return (
                        <li key={n.id} className={n.read_at ? '' : 'unread'}>
                          {d.to ? <Link to={d.to}>{d.text}</Link> : <span>{d.text}</span>}
                          <time dateTime={n.created_at}>{timeAgo(n.created_at)}</time>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>
              <p className="muted small pad"><StatusDot status={profile.status === 'invisible' ? 'offline' : profile.status} /> You appear {profile.status === 'invisible' ? 'offline' : profile.status} — change it from your name in the sidebar.</p>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
