export default function CreateGroupModal({ onClose }) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
        <div className="bg-slate-800 p-6 rounded w-96">
          <h2 className="text-white text-lg mb-4">Create Group</h2>
          <button
            onClick={onClose}
            className="bg-blue-600 px-4 py-2 rounded text-white"
          >
            Close
          </button>
        </div>
      </div>
    );
  }
  