// Skeleton shown while an admin page's data loads, so navigation never feels frozen.
export default function AdminLoading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="skeleton h-3 w-32" />
          <div className="skeleton h-7 w-64" />
        </div>
        <div className="skeleton h-9 w-36" />
      </div>
      <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[104px]" />)}
      </div>
      <div className="skeleton h-[360px]" />
    </div>
  );
}
