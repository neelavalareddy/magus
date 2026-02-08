export default function FreeNowSidebar({ freeUsers }) {
    return (
      <div className="w-64 bg-slate-800 p-4 rounded">
        <h3 className="text-white font-semibold mb-3">Free Right Now</h3>
  
        {freeUsers.length === 0 ? (
          <p className="text-slate-400 text-sm">No one free</p>
        ) : (
          freeUsers.map(u => (
            <div key={u.id} className="flex items-center gap-3 mb-2">
              <div
                className="w-8 h-8 rounded-full text-white flex items-center justify-center"
                style={{ backgroundColor: u.color }}
              >
                {u.avatar}
              </div>
              <span className="text-white text-sm">{u.name}</span>
            </div>
          ))
        )}
      </div>
    );
  }
  