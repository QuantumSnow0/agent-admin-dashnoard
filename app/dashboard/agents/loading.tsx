export default function AgentsLoading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-40 rounded-lg bg-gray-200" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-24 rounded-xl border border-gray-200 bg-white" />
        ))}
      </div>
      <div className="h-[32rem] rounded-xl border border-gray-200 bg-white" />
    </div>
  );
}
