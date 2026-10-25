import { LuGhost } from 'react-icons/lu';
import { navigate } from '../lib/router.jsx';
import { Button, EmptyState } from '../components/ui.jsx';

export default function NotFoundPage() {
  return (
    <EmptyState icon={LuGhost} title="This page ghosted you" action={<Button variant="primary" onClick={() => navigate('/')}>Back to the lobby</Button>}>
      That link doesn't lead anywhere in PartyUp. It may have been deleted, or it never respawned.
    </EmptyState>
  );
}
