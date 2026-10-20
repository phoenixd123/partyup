import { LuMapPinOff } from 'react-icons/lu';
import { navigate } from '../lib/router.jsx';
import { Button, EmptyState } from '../components/ui.jsx';

export default function NotFoundPage() {
  return (
    <EmptyState icon={LuMapPinOff} title="Page not found" action={<Button variant="primary" onClick={() => navigate('/')}>Go home</Button>}>
      That link doesn't lead anywhere in PartyUp.
    </EmptyState>
  );
}
