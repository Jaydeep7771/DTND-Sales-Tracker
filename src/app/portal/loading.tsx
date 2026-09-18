export default function PortalLoading() {
  return (
    <div className="grid gap-5 grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-[420px] hidden md:block" />
      <div className="flex flex-col gap-3.5">
        <div className="skeleton h-10" />
        <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}>
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-[300px]" />)}
        </div>
      </div>
    </div>
  );
}
