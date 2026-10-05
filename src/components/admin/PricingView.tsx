"use client";

/**
 * The rate card.
 *
 * Two tabs, because they answer two different questions. "Tiers" is
 * what a class of customer pays; "Contracts" is what one named account
 * pays. They share a rule table underneath — the difference is only
 * which scope the rule is written against — but an operator thinks
 * about them separately, so the screen does too.
 */
import { useMemo, useState, useTransition } from "react";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { money, num } from "@/lib/format";
import { deletePriceRule, savePriceList, savePriceRule, setCustomerPriceList } from "@/lib/pricing-actions";
import type { PriceList, PriceRule } from "@/types/database";

interface ProductLite { id: string; sku: string; name: string; price: number; unit_of_measure: string }
interface CustomerLite { id: string; name: string; price_list_id: string | null }

type Tab = "tiers" | "contracts" | "customers";

export default function PricingView({
  lists, rules, products, customers, canEdit,
}: {
  lists: PriceList[];
  rules: PriceRule[];
  products: ProductLite[];
  customers: CustomerLite[];
  canEdit: boolean;
}) {
  const [tab, setTab] = useState<Tab>("tiers");
  const [listId, setListId] = useState(lists.find((l) => !l.is_default)?.id ?? lists[0]?.id ?? "");
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [editing, setEditing] = useState<PriceRule | "new" | null>(null);
  const [editingList, setEditingList] = useState<PriceList | "new" | null>(null);
  const toast = useToast();

  const byProduct = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const scopeRules = useMemo(() => {
    const scoped = tab === "contracts"
      ? rules.filter((r) => r.customer_id === customerId)
      : rules.filter((r) => r.price_list_id === listId);
    // Grouped by product, then by break, so a ladder reads top to bottom.
    return [...scoped].sort((a, b) => {
      const pa = byProduct.get(a.product_id)?.name ?? "";
      const pb = byProduct.get(b.product_id)?.name ?? "";
      return pa.localeCompare(pb) || a.min_quantity - b.min_quantity;
    });
  }, [rules, tab, listId, customerId, byProduct]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rules) {
      const key = r.price_list_id ?? r.customer_id ?? "";
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [rules]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1.5 flex-wrap">
        {([["tiers", "Trade tiers"], ["contracts", "Customer contracts"], ["customers", "Who sits where"]] as [Tab, string][]).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            aria-current={tab === k ? "true" : undefined}
            className={`rounded-[7px] px-3 py-2 text-[13px] border ${tab === k ? "bg-navy text-white border-navy" : "bg-surface border-border text-slate-dark hover:border-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "customers" && (
        <WhoSitsWhere lists={lists} customers={customers} rules={rules} canEdit={canEdit} />
      )}

      {tab === "tiers" && (
        <Card>
          <CardHeader
            title="Trade tiers"
            sub="A tier is what a class of customer pays. Standard carries no rules at all — it simply means list price."
            action={canEdit ? <Button variant="secondary" onClick={() => setEditingList("new")}>New tier</Button> : undefined}
          />
          <div className="px-4 pb-3 flex gap-1.5 flex-wrap">
            {lists.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setListId(l.id)}
                className={`rounded-[7px] px-2.5 py-1.5 text-[12.5px] border flex items-center gap-1.5 ${listId === l.id ? "bg-selected border-accent text-navy font-semibold" : "bg-surface border-border text-slate-dark hover:border-muted"}`}
              >
                {l.name}
                {l.is_default && <Badge tone="info" className="text-[10px]">default</Badge>}
                {!l.is_active && <Badge tone="danger" className="text-[10px]">retired</Badge>}
                <span className="font-mono text-[10.5px] text-muted">{counts.get(l.id) ?? 0}</span>
              </button>
            ))}
          </div>
          {canEdit && listId && (
            <div className="px-4 pb-3 flex gap-2">
              <Button variant="secondary" onClick={() => setEditing("new")}>Add a rate</Button>
              <Button variant="secondary" onClick={() => setEditingList(lists.find((l) => l.id === listId) ?? null)}>Edit this tier</Button>
            </div>
          )}
          <RuleTable rules={scopeRules} byProduct={byProduct} canEdit={canEdit} onEdit={setEditing} />
        </Card>
      )}

      {tab === "contracts" && (
        <Card>
          <CardHeader
            title="Customer contracts"
            sub="A negotiated price for one account. It beats their tier on that product, on every quantity, until it expires."
            action={canEdit && customerId ? <Button variant="secondary" onClick={() => setEditing("new")}>Add a contract line</Button> : undefined}
          />
          <div className="px-4 pb-3 max-w-[380px]">
            <Field label="Customer">
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{counts.get(c.id) ? ` · ${counts.get(c.id)} lines` : ""}</option>
                ))}
              </Select>
            </Field>
          </div>
          <RuleTable rules={scopeRules} byProduct={byProduct} canEdit={canEdit} onEdit={setEditing} />
        </Card>
      )}

      {editing && (
        <RuleModal
          rule={editing === "new" ? null : editing}
          scope={tab === "contracts" ? { customer_id: customerId } : { price_list_id: listId }}
          scopeLabel={tab === "contracts" ? (customers.find((c) => c.id === customerId)?.name ?? "") : (lists.find((l) => l.id === listId)?.name ?? "")}
          products={products}
          onClose={() => setEditing(null)}
          onDone={(msg) => { setEditing(null); toast.push(msg, "success"); }}
        />
      )}

      {editingList && (
        <ListModal
          list={editingList === "new" ? null : editingList}
          onClose={() => setEditingList(null)}
          onDone={(msg) => { setEditingList(null); toast.push(msg, "success"); }}
        />
      )}
    </div>
  );
}

function RuleTable({
  rules, byProduct, canEdit, onEdit,
}: {
  rules: PriceRule[];
  byProduct: Map<string, ProductLite>;
  canEdit: boolean;
  onEdit: (r: PriceRule) => void;
}) {
  const [busy, start] = useTransition();
  const toast = useToast();

  if (!rules.length) {
    return <div className="px-4 py-8 text-center text-[13px] text-slate">No rules here yet. Anything without a rule falls through to list price.</div>;
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] border-collapse">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate border-b border-border">
            <th className="px-4 py-2 font-semibold">Product</th>
            <th className="px-4 py-2 font-semibold text-right">From qty</th>
            <th className="px-4 py-2 font-semibold text-right">Unit price</th>
            <th className="px-4 py-2 font-semibold text-right">vs list</th>
            <th className="px-4 py-2 font-semibold">Term</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => {
            const p = byProduct.get(r.product_id);
            const list = p?.price ?? 0;
            const delta = list > 0 ? ((r.unit_price - list) / list) * 100 : 0;
            const expired = !!r.valid_to && r.valid_to < today;
            const pending = !!r.valid_from && r.valid_from > today;
            return (
              <tr key={r.id} className={`border-b border-border-soft ${expired ? "opacity-55" : ""}`}>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{p?.name ?? "Unknown product"}</div>
                  <div className="font-mono text-[11px] text-slate">{p?.sku} · list {money(list)}</div>
                </td>
                <td className="px-4 py-2.5 text-right font-mono">{r.min_quantity > 1 ? num(r.min_quantity) + "+" : "any"}</td>
                <td className="px-4 py-2.5 text-right font-mono font-semibold">{money(r.unit_price)}</td>
                <td className={`px-4 py-2.5 text-right font-mono ${delta < 0 ? "text-success" : delta > 0 ? "text-danger" : "text-slate"}`}>
                  {delta === 0 ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`}
                </td>
                <td className="px-4 py-2.5 text-[12px] text-slate">
                  {expired && <Badge tone="danger" className="text-[10px] mr-1.5">expired</Badge>}
                  {pending && <Badge tone="info" className="text-[10px] mr-1.5">not yet</Badge>}
                  {r.valid_from || r.valid_to ? `${r.valid_from ?? "open"} → ${r.valid_to ?? "open"}` : "open-ended"}
                  {r.note && <div className="text-[11px] text-muted mt-0.5">{r.note}</div>}
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {canEdit && (
                    <>
                      <button type="button" onClick={() => onEdit(r)} className="text-[12px] bg-transparent border-0 p-0 mr-3 cursor-pointer text-slate-dark hover:text-navy">Edit</button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => start(async () => {
                          const res = await deletePriceRule(r.id);
                          toast.push(res.ok ? "Rule removed." : res.error, res.ok ? "success" : "error");
                        })}
                        className="text-[12px] bg-transparent border-0 p-0 cursor-pointer text-slate hover:text-danger"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RuleModal({
  rule, scope, scopeLabel, products, onClose, onDone,
}: {
  rule: PriceRule | null;
  scope: { price_list_id?: string; customer_id?: string };
  scopeLabel: string;
  products: ProductLite[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [productId, setProductId] = useState(rule?.product_id ?? products[0]?.id ?? "");
  const [minQty, setMinQty] = useState(String(rule?.min_quantity ?? 1));
  const [price, setPrice] = useState(String(rule?.unit_price ?? ""));
  const [from, setFrom] = useState(rule?.valid_from ?? "");
  const [to, setTo] = useState(rule?.valid_to ?? "");
  const [note, setNote] = useState(rule?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const product = products.find((p) => p.id === productId);
  const entered = Number(price);
  // Show the margin against list while they type, because a rate card is
  // the easiest place in the business to give away a point by accident.
  const delta = product && product.price > 0 && Number.isFinite(entered) && price !== ""
    ? ((entered - product.price) / product.price) * 100
    : null;

  function save() {
    setError(null);
    start(async () => {
      const res = await savePriceRule(rule?.id ?? null, {
        ...scope,
        product_id: productId,
        min_quantity: Number(minQty),
        unit_price: Number(price),
        valid_from: from || null,
        valid_to: to || null,
        note,
      });
      if (!res.ok) return setError(res.error);
      onDone(rule ? "Rule updated." : "Rule added.");
    });
  }

  return (
    <Modal title={rule ? "Edit price rule" : `New price rule · ${scopeLabel}`} onClose={onClose}>
      <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <Field label="Product" className="col-span-full">
          <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
            {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
          </Select>
        </Field>
        <Field label="Applies from quantity">
          <Input value={minQty} inputMode="numeric" onChange={(e) => setMinQty(e.target.value)} mono />
        </Field>
        <Field label={`Unit price${product ? ` (list ${money(product.price)})` : ""}`}>
          <Input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} mono />
        </Field>
        <Field label="Valid from">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Valid to">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Note" className="col-span-full">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Agreed with Imran, 12 Sept. Reviewed annually." />
        </Field>
      </div>

      {delta !== null && (
        <div className={`mt-3 text-[12.5px] ${delta < 0 ? "text-success" : delta > 0 ? "text-danger" : "text-slate"}`}>
          {delta === 0 ? "Same as list price." : `${Math.abs(delta).toFixed(1)}% ${delta < 0 ? "below" : "above"} list price.`}
        </div>
      )}
      <div className="mt-2 text-[12px] text-slate">
        Set &ldquo;applies from quantity&rdquo; above 1 to make this a volume break. Several rules on the same product build a ladder.
      </div>

      {error && <div className="mt-3 rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</div>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save rule"}</Button>
      </div>
    </Modal>
  );
}

function ListModal({ list, onClose, onDone }: { list: PriceList | null; onClose: () => void; onDone: (m: string) => void }) {
  const [name, setName] = useState(list?.name ?? "");
  const [description, setDescription] = useState(list?.description ?? "");
  const [isDefault, setIsDefault] = useState(list?.is_default ?? false);
  const [isActive, setIsActive] = useState(list?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  return (
    <Modal title={list ? `Edit ${list.name}` : "New trade tier"} onClose={onClose}>
      <div className="flex flex-col gap-3.5">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Distributor" /></Field>
        <Field label="Description">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Trade accounts buying for resale." />
        </Field>
        <label className="flex items-center gap-2 text-[13px] text-slate-dark">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="accent-accent" />
          Default tier — what a new customer gets
        </label>
        <label className="flex items-center gap-2 text-[13px] text-slate-dark">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="accent-accent" />
          Active
        </label>
      </div>
      {error && <div className="mt-3 rounded-lg bg-danger-bg border border-danger-bd px-3 py-2 text-[13px] text-danger">{error}</div>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          disabled={busy}
          onClick={() => start(async () => {
            setError(null);
            const res = await savePriceList(list?.id ?? null, { name, description, is_default: isDefault, is_active: isActive });
            if (!res.ok) return setError(res.error);
            onDone(list ? "Tier updated." : "Tier created.");
          })}
        >
          {busy ? "Saving…" : "Save tier"}
        </Button>
      </div>
    </Modal>
  );
}

function WhoSitsWhere({
  lists, customers, rules, canEdit,
}: {
  lists: PriceList[];
  customers: CustomerLite[];
  rules: PriceRule[];
  canEdit: boolean;
}) {
  const [busy, start] = useTransition();
  const toast = useToast();
  const defaultList = lists.find((l) => l.is_default);
  const contractCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rules) if (r.customer_id) m.set(r.customer_id, (m.get(r.customer_id) ?? 0) + 1);
    return m;
  }, [rules]);

  return (
    <Card>
      <CardHeader title="Who sits where" sub="Moving an account between tiers changes what they see in the catalogue immediately. Orders already placed keep the price they were submitted at." />
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate border-b border-border">
              <th className="px-4 py-2 font-semibold">Customer</th>
              <th className="px-4 py-2 font-semibold">Tier</th>
              <th className="px-4 py-2 font-semibold">Contract lines</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-b border-border-soft">
                <td className="px-4 py-2.5 font-medium">{c.name}</td>
                <td className="px-4 py-2.5">
                  <Select
                    value={c.price_list_id ?? ""}
                    disabled={!canEdit || busy}
                    onChange={(e) => {
                      const next = e.target.value || null;
                      start(async () => {
                        const res = await setCustomerPriceList(c.id, next);
                        toast.push(res.ok ? `${c.name} moved.` : res.error, res.ok ? "success" : "error");
                      });
                    }}
                    className="max-w-[220px]"
                  >
                    <option value="">{defaultList ? `${defaultList.name} (default)` : "Default"}</option>
                    {lists.filter((l) => l.is_active && !l.is_default).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </Select>
                </td>
                <td className="px-4 py-2.5 font-mono text-[12px] text-slate">{contractCount.get(c.id) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
