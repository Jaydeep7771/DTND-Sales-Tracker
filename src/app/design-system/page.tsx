import ScreenSwitcher from "@/components/ScreenSwitcher";
import { Badge, Button, Card, Input } from "@/components/ui";
import { isDemo } from "@/lib/data";

const PALETTE = [
  ["Primary navy", "#123A5E", "Primary buttons, brand"], ["Navy hover", "#1C5488", "Hover, links"], ["Accent blue", "#2F7DD1", "Focus, selection"],
  ["Ink", "#0F1B2B", "Primary text"], ["Slate", "#64748B", "Labels, meta"], ["Border", "#E2E8F0", "Dividers, inputs"],
  ["Canvas", "#F4F6F9", "App background"], ["Surface", "#FFFFFF", "Cards, tables"], ["Success", "#0E7A46", "Fulfilled, in stock"],
  ["Warning", "#8A5A0B", "Pending, low stock"], ["Danger", "#B42318", "Rejected, backorder"], ["Sidebar", "#12263C", "Admin navigation"],
];
const RULES = [
  ["4 / 8 spacing", "All padding and gaps are multiples of 4px; table cells 11px × 14px for scan-dense rows."],
  ["Radius", "6px controls, 8px inputs and buttons, 10px cards, 20px pills. Nothing larger."],
  ["Mono for data", "Every SKU, quantity, currency and order id uses IBM Plex Mono so columns align optically."],
  ["One accent", "Accent blue marks only interaction and selection; status colour is never reused for emphasis."],
];

export default function DesignSystemPage() {
  return (
    <>
      {isDemo && <ScreenSwitcher />}
      <div className="max-w-[1100px] w-full mx-auto px-5 pt-[30px] pb-[60px] flex flex-col gap-[26px]">
        <div>
          <div className="text-[11px] tracking-[.09em] uppercase text-slate font-semibold">Dynamic Traders &amp; Distributors</div>
          <h1 className="mt-1.5 text-[30px] font-semibold tracking-[-.02em]">Design system</h1>
          <div className="text-sm text-slate-strong mt-1.5 max-w-[620px]">A restrained navy-and-slate system built for dense tables: one accent for interaction, four semantic status colours, and a mono face reserved for every number, SKU and identifier.</div>
        </div>

        <Card className="p-[18px]">
          <div className="label">Palette</div>
          <div className="grid gap-3 mt-3.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
            {PALETTE.map(([name, hex, use]) => (
              <div key={hex}>
                <div className="h-14 rounded-lg border border-[rgba(15,27,43,.12)]" style={{ background: hex }} />
                <div className="text-[12.5px] font-semibold mt-[7px]">{name}</div>
                <div className="font-mono text-[11px] text-slate">{hex}</div>
                <div className="text-[11px] text-muted mt-px">{use}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-[18px] grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <div>
            <div className="label">Typography</div>
            <div className="mt-3 flex flex-col gap-2.5">
              <div className="text-[26px] font-semibold tracking-[-.02em]">IBM Plex Sans · 600 / 26px</div>
              <div className="text-base font-semibold">Section heading · 600 / 16px</div>
              <div className="text-[13.5px] text-slate-dark">Body and table text · 400 / 13.5px — legible at density, neutral in tone, wide language coverage.</div>
              <div className="label">Label · 600 / 11px / .08em</div>
              <div className="font-mono text-sm">IBM Plex Mono · PKR 284,600 · DT-24188 · SKU FAS-0142</div>
            </div>
          </div>
          <div>
            <div className="label">Controls</div>
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex gap-2.5 flex-wrap">
                <Button>Primary action</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="destructive">Destructive</Button>
              </div>
              <Input placeholder="Input field · 13.5px" />
              <div className="flex gap-2 flex-wrap">
                <Badge tone="warning">Pending</Badge>
                <Badge tone="info">Approved</Badge>
                <Badge tone="danger">Rejected</Badge>
                <Badge tone="success">Fulfilled</Badge>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-[18px]">
          <div className="label">Layout rules</div>
          <div className="grid gap-3.5 mt-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {RULES.map(([k, v]) => (
              <div key={k} className="border border-border-soft bg-surface-softer rounded-lg p-[13px]">
                <div className="text-[13px] font-semibold">{k}</div>
                <div className="text-[12.5px] text-slate-strong mt-[5px] leading-[1.5]">{v}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
