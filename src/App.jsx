import { useEffect } from 'react';
import { useKonami } from './lib/easterEggs.js';
import { isConfigured } from './lib/supabase.js';
import { useRoute, match, Redirect } from './lib/router.jsx';
import { AppProvider, useApp } from './context/AppContext.jsx';
import { FeedbackProvider } from './components/feedback.jsx';
import { PageLoader, ErrorState, Button } from './components/ui.jsx';
import AppShell from './components/layout/AppShell.jsx';
import { lazy, Suspense } from 'react';
import Logo from './components/Logo.jsx';
import { SeasonalDecor } from './components/Seasonal.jsx';
import { CallProvider } from './context/CallContext.jsx';
import { CallAudio, IncomingCalls } from './components/CallUI.jsx';

// Developer-only screen for pointing a local build at a Supabase project.
// Release builds have the project baked in and never include or show it.
const SetupPage = import.meta.env.DEV ? lazy(() => import('./pages/SetupPage.jsx')) : null;
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
import TournamentsPage from './pages/TournamentsPage.jsx';
import CreateTournamentPage from './pages/CreateTournamentPage.jsx';
import TournamentPage from './pages/TournamentPage.jsx';
import TournamentAgreementPage from './pages/TournamentAgreementPage.jsx';

const ROUTES = [
  ['/', DashboardPage],
  ['/players', FindPlayersPage],
  ['/players/:id', PlayerProfilePage],
  ['/match', QuickMatchPage],
  ['/parties', PartiesPage],
  ['/parties/new', CreatePartyPage],
  ['/parties/:id', PartyDetailPage],
  ['/tournaments', TournamentsPage],
  ['/tournaments/new', CreateTournamentPage],
  ['/tournaments/agreement', TournamentAgreementPage],
  ['/tournaments/:id', TournamentPage],
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

  if (session === undefined) return <PageLoader full />;

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
    return <PageLoader full label="Loading your profile…" />;
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

function EasterEggs() { useKonami(); return null; }

function SignedIn({ children }) {
  const { session, profile } = useApp();
  return session && profile?.onboarded_at ? children : null;
}

export default function App() {
  if (!isConfigured) {
    if (SetupPage) return <FeedbackProvider><Suspense fallback={<PageLoader />}><SetupPage /></Suspense></FeedbackProvider>;
    return (
      <div className="center-screen">
        <div className="empty">
          <Logo />
          <h3>PartyUp can't start</h3>
          <div className="empty-body">This copy of PartyUp was built without its server settings. Download the latest version from the PartyUp releases page.</div>
          <div className="empty-action"><a className="btn" href="https://github.com/phoenixd123/partyup/releases/latest" target="_blank" rel="noreferrer">Get the latest version</a></div>
        </div>
      </div>
    );
  }
  return (
    <FeedbackProvider>
      <SeasonalDecor />
      <AppProvider>
        <CallProvider>
          <Routed />
          <CallAudio />
          <SignedIn><IncomingCalls /></SignedIn>
          <EasterEggs />
        </CallProvider>
      </AppProvider>
    </FeedbackProvider>
  );
}
