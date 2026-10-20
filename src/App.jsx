import { useEffect } from 'react';
import { isConfigured } from './lib/supabase.js';
import { useRoute, match, Redirect } from './lib/router.jsx';
import { AppProvider, useApp } from './context/AppContext.jsx';
import { FeedbackProvider } from './components/feedback.jsx';
import { PageLoader, ErrorState, Button } from './components/ui.jsx';
import AppShell from './components/layout/AppShell.jsx';
import SetupPage from './pages/SetupPage.jsx';
import { LoginPage, SignupPage, ForgotPage, ResetPage } from './pages/AuthPages.jsx';
import OnboardingPage from './pages/OnboardingPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import FindPlayersPage from './pages/FindPlayersPage.jsx';
import PlayerProfilePage from './pages/PlayerProfilePage.jsx';
import QuickMatchPage from './pages/QuickMatchPage.jsx';
import PartiesPage from './pages/PartiesPage.jsx';
import CreatePartyPage from './pages/CreatePartyPage.jsx';
import PartyDetailPage from './pages/PartyDetailPage.jsx';
import FriendsPage from './pages/FriendsPage.jsx';
import MessagesPage from './pages/MessagesPage.jsx';
import GameProfilesPage from './pages/GameProfilesPage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import ModerationPage from './pages/ModerationPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import CommunityPage from './pages/CommunityPage.jsx';
import CommunitySettingsPage from './pages/CommunitySettingsPage.jsx';
import ExplorePage from './pages/ExplorePage.jsx';
import InvitePage from './pages/InvitePage.jsx';

const ROUTES = [
  ['/', DashboardPage],
  ['/players', FindPlayersPage],
  ['/players/:id', PlayerProfilePage],
  ['/match', QuickMatchPage],
  ['/parties', PartiesPage],
  ['/parties/new', CreatePartyPage],
  ['/parties/:id', PartyDetailPage],
  ['/friends', FriendsPage],
  ['/messages', MessagesPage],
  ['/messages/:id', MessagesPage],
  ['/games', GameProfilesPage],
  ['/notifications', NotificationsPage],
  ['/settings', SettingsPage],
  ['/settings/:tab', SettingsPage],
  ['/moderation', ModerationPage],
  ['/moderation/:id', ModerationPage],
  ['/explore', ExplorePage],
  ['/invite/:code', InvitePage],
  ['/c/:id', CommunityPage],
  ['/c/:id/settings', CommunitySettingsPage],
  ['/c/:id/:channel', CommunityPage],
];

const AUTH_ROUTES = { '/login': LoginPage, '/signup': SignupPage, '/forgot': ForgotPage, '/reset': ResetPage };

function Routed() {
  const { path, query } = useRoute();
  const { session, profile, profileError, refreshProfile, recovery, signOut } = useApp();

  useEffect(() => { window.scrollTo(0, 0); }, [path]);

  if (session === undefined) return <PageLoader label="Starting PartyUp" />;

  if (recovery || (path === '/reset' && session)) return <ResetPage />;

  if (!session) {
    const Page = AUTH_ROUTES[path];
    if (!Page) {
      if (path.startsWith('/invite/')) { try { sessionStorage.setItem('partyup.after', path); } catch { /* ignore */ } }
      return <Redirect to="/login" />;
    }
    return <Page query={query} />;
  }

  if (AUTH_ROUTES[path]) return <Redirect to="/" />;

  if (!profile) {
    if (profileError) {
      return (
        <div className="center-screen">
          <ErrorState error={profileError} onRetry={refreshProfile} title="Couldn't load your profile" />
          <p className="muted small center">If this is a fresh project, make sure supabase/schema.sql has been run. <Button variant="link" onClick={signOut}>Sign out</Button></p>
        </div>
      );
    }
    return <PageLoader label="Loading your profile" />;
  }

  if (profile.is_banned) {
    return (
      <div className="center-screen">
        <div className="empty"><h3>This account has been banned</h3><div className="empty-body">A moderator banned this account for breaking the community guidelines.</div>
          <div className="empty-action"><Button onClick={signOut}>Sign out</Button></div></div>
      </div>
    );
  }

  if (!profile.onboarded_at) return <OnboardingPage />;

  let after = null;
  try { after = sessionStorage.getItem('partyup.after'); if (after) sessionStorage.removeItem('partyup.after'); } catch { /* ignore */ }
  if (after && after !== path) return <Redirect to={after} />;

  for (const [pattern, Page] of ROUTES) {
    const params = match(pattern, path);
    if (params) return <AppShell path={path}><Page params={params} query={query} key={pattern.startsWith('/messages') ? '/messages' : path} /></AppShell>;
  }
  return <AppShell path={path}><NotFoundPage /></AppShell>;
}

export default function App() {
  if (!isConfigured) return <FeedbackProvider><SetupPage /></FeedbackProvider>;
  return (
    <FeedbackProvider>
      <AppProvider>
        <Routed />
      </AppProvider>
    </FeedbackProvider>
  );
}
