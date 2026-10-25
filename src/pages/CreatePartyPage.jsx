import { celebrate } from '../lib/confetti.js';
import * as api from '../lib/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useApp } from '../context/AppContext.jsx';
import { navigate } from '../lib/router.jsx';
import { ErrorState, PageHeader, PageLoader, Panel } from '../components/ui.jsx';
import { useToast } from '../components/feedback.jsx';
import PartyForm from '../components/PartyForm.jsx';

export default function CreatePartyPage() {
  const { profile, userId } = useApp();
  const toast = useToast();
  const games = useAsync(() => api.getGames(), []);
  const mine = useAsync(() => api.getMyGameProfiles(userId), [userId]);
  if (games.loading || mine.loading) return <PageLoader />;
  if (games.error || mine.error) return <ErrorState error={games.error || mine.error} onRetry={() => { games.reload(); mine.reload(); }} />;

  const submit = async (v) => {
    const id = await api.createParty({
      p_game: v.game, p_title: v.title.trim(), p_max_size: v.max_size, p_description: v.description.trim(),
      p_needed_roles: v.needed_roles, p_play_type: v.play_type, p_min_rank: v.min_rank, p_max_rank: v.max_rank,
      p_language: v.language, p_region: v.region, p_platform: v.platform, p_mic_required: v.mic_required,
      p_visibility: v.visibility, p_scheduled_for: v.scheduled_for, p_my_role: v.my_role,
    });
    toast('Party created');
    celebrate();
    navigate(`/parties/${id}`, { replace: true });
  };

  return (
    <div className="narrow">
      <PageHeader title="Create a party" sub="Set the slots and requirements — players who fit will see it first." />
      <Panel>
        <PartyForm games={games.data} myProfile={profile} myGameProfiles={mine.data} onSubmit={submit} onCancel={() => window.history.back()} />
      </Panel>
    </div>
  );
}
