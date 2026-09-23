export default function DashboardLoading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-48 rounded-lg bg-gray-200" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 rounded-xl border border-gray-200 bg-white" />
        ))}
      </div>
      <div className="h-[28rem] rounded-xl border border-gray-200 bg-white" />
    </div>
  );
}
