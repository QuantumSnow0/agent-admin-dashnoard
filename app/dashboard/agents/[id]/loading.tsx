export default function AgentProfileLoading() {
  return (
    <div className="animate-pulse space-y-4 -ml-2 -mt-6">
      <div className="h-4 w-28 rounded bg-gray-200" />
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="h-10 w-10 rounded-lg bg-indigo-100" />
          <div className="flex-1 space-y-2">
            <div className="h-5 w-48 rounded bg-gray-200" />
            <div className="h-3 w-72 rounded bg-gray-100" />
          </div>
        </div>
        <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-3">
          <div className="h-4 w-full max-w-xl rounded bg-gray-200" />
        </div>
      </div>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-36 rounded-xl border border-gray-200 bg-white" />
      ))}
    </div>
  );
}
