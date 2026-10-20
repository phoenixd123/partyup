import { useState } from 'react';
import { LuCheckCheck, LuSettings } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useApp } from '../context/AppContext.jsx';
import { navigate } from '../lib/router.jsx';
import { Button, PageHeader, Segmented, Panel } from '../components/ui.jsx';
import { useToast } from '../components/feedback.jsx';
import NotificationList from '../components/NotificationList.jsx';

export default function NotificationsPage() {
  const { counts, refreshCounts } = useApp();
  const toast = useToast();
  const [filter, setFilter] = useState('all');
  const [key, setKey] = useState(0);
  const markAll = async () => {
    try { await api.markNotificationsRead(null); refreshCounts(); setKey((k) => k + 1); toast('All caught up'); } catch (e) { toast(e, 'error'); }
  };
  return (
    <div className="narrow">
      <PageHeader title="Notifications"
        actions={<>
          <Button icon={LuCheckCheck} onClick={markAll} disabled={!counts.notifications}>Mark all read</Button>
          <Button variant="ghost" icon={LuSettings} onClick={() => navigate('/settings/notifications')}>Preferences</Button>
        </>} />
      <Segmented ariaLabel="Filter notifications" value={filter} onChange={setFilter}
        options={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread', count: counts.notifications }]} />
      <Panel className="mt">
        <NotificationList key={`${filter}-${key}`} limit={60} unreadOnly={filter === 'unread'} />
      </Panel>
    </div>
  );
}
