import { Calendar, Plus } from 'lucide-react';

export default function Header({ onNewGroup }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <Calendar className="text-blue-400" />
        <h1 className="text-2xl font-bold text-white">GroupSync</h1>
      </div>

      <button
        onClick={onNewGroup}
        className="flex items-center gap-2 bg-slate-700 text-white px-4 py-2 rounded"
      >
        <Plus size={16} />
        New Group
      </button>
    </div>
  );
}
