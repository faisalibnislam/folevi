"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ExternalLink } from "lucide-react";
import { api } from "@/lib/convex/api";
import { formatPrice } from "@/lib/plans";
import { Button } from "@/components/ui/Button";
import { ActionDialog } from "./ActionDialog";
import { useAdmin } from "./AdminApp";
import { rolesFor } from "./permissions";
import { Badge, Callout, DataTable, DocTitle, KeyValues, LoadingRows, Mono, PageHeader, Panel, Time, td, th } from "./ui";

type Overview = FunctionReturnType<typeof api.billingSetup.overview>;
type Product = Overview["products"][number];
type RunResult = FunctionReturnType<typeof api.billingSetup.checkPolar>;

type Pending = { kind: "check" } | { kind: "create"; missing: number } | { kind: "pin"; product: Product };

const INTERVAL: Record<string, string> = { month: "a month", year: "a year" };

function priceLabel(p: Product): string {
  const price = formatPrice(p.priceCents);
  if (p.type === "one_time") return `${price} once`;
  return `${price}${p.seatBased ? " per seat" : ""} ${INTERVAL[p.interval ?? "month"]}`;
}

const SOURCE: Record<string, string> = {
  created: "Created here",
  matched: "Found in Polar",
  pinned: "Used although it differs",
  env: "From the env var",
};

function StatusCell({ p }: { p: Product }) {
  if (p.status === "not_created") return <Badge>Not created</Badge>;
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {p.status === "mismatch" ? <Badge tone="warning">Mismatch</Badge> : <Badge tone="success">Created</Badge>}
        {p.source ? <span className="text-[12px] text-muted">{SOURCE[p.source] ?? p.source}</span> : null}
      </div>
      {p.polarProductId ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Mono wrap>{p.polarProductId}</Mono>
          {p.dashboardUrl ? (
            <a href={p.dashboardUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium text-heading underline decoration-line-strong underline-offset-2 hover:decoration-heading">
              Open in Polar
              <ExternalLink size={12} aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : null}
        </div>
      ) : null}
      {p.differences.length ? (
        <ul className="list-disc pl-4 text-[12.5px] text-ink">
          {p.differences.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : null}
      {p.status === "mismatch" ? <p className="text-[12px] text-muted">{p.inUse ? "Checkout sells this product. Fix it in Polar, then check again." : "Not used yet. Fix it in Polar and check again, or use it anyway."}</p> : null}
    </div>
  );
}

function runSummary(r: RunResult, kind: "check" | "create"): string {
  const parts: string[] = [];
  if (kind === "create") parts.push(r.created.length ? `Created ${r.created.length} ${r.created.length === 1 ? "product" : "products"} in Polar.` : "Nothing to create.");
  parts.push(`${r.found} of 14 found in Polar.`);
  if (r.mismatched.length) parts.push(`${r.mismatched.length} ${r.mismatched.length === 1 ? "differs" : "differ"} from the catalog.`);
  if (kind === "check" && r.missing.length) parts.push(`${r.missing.length} not created yet.`);
  return parts.join(" ");
}

/** Owner only: the Polar connection, the 14 products Folevi sells, and creating the missing ones. */
export function BillingSetupView() {
  const admin = useAdmin();
  const allowed = admin.can("billing.setup");
  const data = useQuery(api.billingSetup.overview, allowed ? {} : "skip");
  const checkPolar = useAction(api.billingSetup.checkPolar);
  const createMissing = useAction(api.billingSetup.createMissing);
  const pinProduct = useMutation(api.billingSetup.useProductAnyway);
  const [pending, setPending] = useState<Pending | null>(null);
  const close = () => setPending(null);

  if (!allowed) {
    return (
      <>
        <DocTitle>Billing setup</DocTitle>
        <PageHeader title="Billing setup" />
        <Callout>{rolesFor("billing.setup")}</Callout>
      </>
    );
  }

  const connected = Boolean(data?.tokenSet);
  const missing = data ? data.products.filter((p) => p.status === "not_created").length : 0;
  const offReason = !connected ? "Set POLAR_ACCESS_TOKEN in the Convex environment first." : undefined;

  return (
    <>
      <DocTitle>Billing setup</DocTitle>
      <PageHeader
        title="Billing setup"
        description="The 14 products Folevi sells through Polar. Names and prices come from the plan catalog in the code. Nothing here changes or archives a product that already exists in Polar."
        actions={
          <>
            <Button disabled={!connected} title={offReason} onClick={() => setPending({ kind: "check" })}>
              Check Polar…
            </Button>
            <Button variant="primary" disabled={!connected || missing === 0} title={offReason ?? (missing === 0 ? "Every product is in Polar." : undefined)} onClick={() => setPending({ kind: "create", missing })}>
              Create missing products…
            </Button>
          </>
        }
      />

      <div className="grid gap-4">
        {data && !data.tokenSet ? (
          <Callout tone="warning" title="Polar isn't connected on this server">
            Set POLAR_SERVER, POLAR_ACCESS_TOKEN (with the products:read and products:write scopes) and POLAR_WEBHOOK_SECRET in the Convex environment, then check Polar. Until then, checkout isn&apos;t available.
          </Callout>
        ) : null}
        {data?.lastError ? (
          <Callout tone="danger" title="The last run didn't finish">
            {data.lastError} <Time ts={data.lastErrorAt} />
          </Callout>
        ) : null}

        <Panel title="Polar connection" description="Whether the server's Polar settings are present. Their values are never shown.">
          {data === undefined ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : (
            <KeyValues
              items={[
                { label: "Server", value: data.server === "production" ? <Badge tone="strong">Production</Badge> : <Badge>Sandbox</Badge> },
                { label: "Access token", value: data.tokenSet ? <Badge tone="success">Set</Badge> : <Badge tone="warning">Not set</Badge> },
                { label: "Webhook secret", value: data.webhookSecretSet ? <Badge tone="success">Set</Badge> : <Badge tone="warning">Not set</Badge> },
                { label: "Last checked", value: data.lastCheckedAt ? <Time ts={data.lastCheckedAt} /> : <span className="text-muted">Never</span> },
                {
                  label: "Polar dashboard",
                  value: (
                    <a href={data.dashboardUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-heading underline decoration-line-strong underline-offset-2 hover:decoration-heading">
                      {data.server === "production" ? "polar.sh" : "sandbox.polar.sh"}
                      <ExternalLink size={12} aria-hidden />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  ),
                },
              ]}
            />
          )}
        </Panel>

        <Panel title="Products" description="Checkout uses the id recorded here first and the POLAR_PRODUCT_* env var as a fallback. Products are matched by their folevi_key metadata, then by exact name." flush>
          <DataTable caption="Polar products" minWidth={880}>
            <thead>
              <tr>
                <th scope="col" className={th}>
                  Product
                </th>
                <th scope="col" className={th}>
                  Type
                </th>
                <th scope="col" className={th}>
                  Price
                </th>
                <th scope="col" className={th}>
                  Seats
                </th>
                <th scope="col" className={th}>
                  Status
                </th>
                <th scope="col" className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data === undefined ? (
                <LoadingRows colSpan={6} rows={8} />
              ) : (
                data.products.map((p) => (
                  <tr key={p.key}>
                    <th scope="row" className={`${td} text-left font-normal`}>
                      <span className="block font-medium text-heading">{p.name}</span>
                      <span className="mt-0.5 block text-[12px] text-muted">
                        <Mono>{p.key}</Mono>
                      </span>
                    </th>
                    <td className={td}>{p.type === "recurring" ? "Subscription" : "One-time"}</td>
                    <td className={`${td} whitespace-nowrap tabular-nums`}>{priceLabel(p)}</td>
                    <td className={td}>{p.seatBased ? "Per seat, at least 1" : <span className="text-muted">No</span>}</td>
                    <td className={td}>
                      <StatusCell p={p} />
                    </td>
                    <td className={`${td} text-right`}>
                      {p.status === "mismatch" ? (
                        <Button size="sm" onClick={() => setPending({ kind: "pin", product: p })} aria-label={`Use the Polar product for ${p.name} anyway`}>
                          Use this product anyway…
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </Panel>
      </div>

      <ActionDialog
        open={pending?.kind === "check"}
        onClose={close}
        title="Check Polar"
        description="Lists your organization's products in Polar, finds each of the 14, records the ids of those that match the catalog and reports those that differ. Nothing in Polar changes."
        confirmLabel="Check Polar"
        onSubmit={async ({ reason, meta }) => runSummary(await checkPolar({ reason, ...meta }), "check")}
      />
      <ActionDialog
        open={pending?.kind === "create"}
        onClose={close}
        title="Create missing products"
        description={
          <>
            Checks Polar first, then creates only the products with nothing found there ({pending?.kind === "create" ? pending.missing : missing} now), with the catalog&apos;s names and prices, and records their ids. Running it again never makes a second copy.
            {data?.server === "production" ? " This is the production Polar organization: these products are sold to real customers." : " This is the Polar sandbox."}
          </>
        }
        confirmLabel="Create products"
        onSubmit={async ({ reason, meta }) => runSummary(await createMissing({ reason, ...meta }), "create")}
      />
      <ActionDialog
        open={pending?.kind === "pin"}
        onClose={close}
        title="Use this product anyway"
        description={
          pending?.kind === "pin" ? (
            <>
              Checkout will sell the Polar product <Mono wrap>{pending.product.polarProductId ?? ""}</Mono> as {pending.product.name}, although it differs from the catalog:
              <ul className="mt-2 list-disc pl-4">
                {pending.product.differences.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </>
          ) : null
        }
        confirmLabel="Use this product"
        onSubmit={async ({ reason, meta }) => {
          if (pending?.kind !== "pin") return "Nothing changed.";
          await pinProduct({ key: pending.product.key, reason, ...meta });
          return `${pending.product.name} now uses this Polar product.`;
        }}
      />
    </>
  );
}
