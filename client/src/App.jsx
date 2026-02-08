import { useState } from 'react';
import Header from './components/Header';
import CalendarView from './components/CalendarView';
import FreeNowSidebar from './components/FreeNowSidebar';
import CreateGroupModal from './components/Modals/CreateGroupModal';
import StatusModal from './components/Modals/StatusModal';
import { connections } from './mock/data';

export default function App() {
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);

  const hours = Array.from({ length: 10 }, (_, i) => i + 9);

  const isBusy = (hour) => hour === 10;

  const freeUsers = connections.filter(() => true);

  return (
    <div className="min-h-screen bg-slate-900 p-6 flex gap-6">
      <div className="flex-1">
        <Header onNewGroup={() => setShowGroupModal(true)} />
        <CalendarView hours={hours} isBusy={isBusy} />
        <button
          onClick={() => setShowStatusModal(true)}
          className="mt-4 bg-slate-700 px-4 py-2 rounded text-white"
        >
          Update Status
        </button>
      </div>

      <FreeNowSidebar freeUsers={freeUsers} />

      {showGroupModal && (
        <CreateGroupModal onClose={() => setShowGroupModal(false)} />
      )}
      {showStatusModal && (
        <StatusModal onClose={() => setShowStatusModal(false)} />
      )}
    </div>
  );
}
