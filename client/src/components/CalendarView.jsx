export default function CalendarView({ hours, isBusy }) {
    return (
      <div className="space-y-2">
        {hours.map(hour => (
          <div key={hour} className="flex gap-4 items-center">
            <div className="w-20 text-slate-400">
              {hour > 12 ? `${hour - 12} PM` : `${hour} AM`}
            </div>
            <div
              className={`flex-1 h-12 rounded ${
                isBusy(hour) ? 'bg-red-500/40' : 'bg-green-500/40'
              }`}
            />
          </div>
        ))}
      </div>
    );
  }
  