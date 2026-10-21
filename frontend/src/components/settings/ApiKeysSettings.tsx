"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { Check, Copy, KeyRound, Loader2, Plus, ShieldAlert, X } from "lucide-react";

type ApiKeyItem = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

type CreatedApiKey = ApiKeyItem & { key: string };

const SCOPES = [
  { id: "webhooks:read", label: "Read webhooks", detail: "View webhook subscriptions and delivery history." },
  { id: "webhooks:write", label: "Manage webhooks", detail: "Create, update, and delete webhook subscriptions." },
];

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function ApiKeysSettings() {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["webhooks:read"]);
  const [expiry, setExpiry] = useState("");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch("/api/auth/api-keys");
      if (!response.ok) throw new ApiError("Could not load API keys", response.status);
      setKeys(await response.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load API keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadKeys(); }, [loadKeys]);

  const createKey = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || scopes.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const response = await apiFetch("/api/auth/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), scopes, ...(expiry ? { expires_at: new Date(`${expiry}T23:59:59`).toISOString() } : {}) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new ApiError(body?.message ?? "Could not create API key", response.status);
      }
      const result: CreatedApiKey = await response.json();
      setCreated(result);
      setName("");
      setExpiry("");
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create API key");
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (key: ApiKeyItem) => {
    if (!window.confirm(`Revoke “${key.name}”? Any application using this key will lose access immediately.`)) return;
    setRevoking(key.id);
    setError(null);
    try {
      const response = await apiFetch(`/api/auth/api-keys/${key.id}`, { method: "DELETE" });
      if (!response.ok) throw new ApiError("Could not revoke API key", response.status);
      setKeys((current) => current.map((item) => item.id === key.id ? { ...item, revoked_at: new Date().toISOString() } : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke API key");
    } finally {
      setRevoking(null);
    }
  };

  const copyKey = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Clipboard access failed. Select and copy the key manually.");
    }
  };

  return (
    <section className="space-y-6" aria-labelledby="api-keys-title">
      <header>
        <div className="mb-2 flex items-center gap-3">
          <KeyRound className="h-7 w-7 text-brand" />
          <h2 id="api-keys-title" className="text-xl font-semibold text-foreground">API keys</h2>
        </div>
        <p className="text-sm text-muted">Create scoped keys for your integrations. A key is shown only once when it is created.</p>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

      {created && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5" role="status">
          <div className="mb-2 flex items-center gap-2 font-semibold text-foreground"><ShieldAlert className="h-5 w-5 text-amber-400" />Copy your new key now</div>
          <p className="mb-3 text-sm text-muted">For your security, the full key will not be available again.</p>
          <div className="flex gap-2">
            <input aria-label="New API key" readOnly value={created.key} className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground" onFocus={(event) => event.currentTarget.select()} />
            <button type="button" onClick={copyKey} className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white"><Copy className="h-4 w-4" />{copied ? "Copied" : "Copy"}</button>
            <button type="button" aria-label="Dismiss new key" onClick={() => setCreated(null)} className="rounded-lg border border-border p-2 text-muted hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      <form onSubmit={createKey} className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <h3 className="mb-4 text-base font-semibold text-foreground">Generate a key</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="api-key-name" className="mb-2 block text-sm font-medium text-foreground">Key name</label>
            <input id="api-key-name" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Production integration" className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-brand/50" />
          </div>
          <div>
            <label htmlFor="api-key-expiry" className="mb-2 block text-sm font-medium text-foreground">Expires (optional)</label>
            <input id="api-key-expiry" type="date" min={new Date().toISOString().slice(0, 10)} value={expiry} onChange={(event) => setExpiry(event.target.value)} className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-brand/50" />
          </div>
        </div>
        <fieldset className="mt-5">
          <legend className="mb-3 text-sm font-medium text-foreground">Permissions</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {SCOPES.map((scope) => (
              <label key={scope.id} className="flex cursor-pointer gap-3 rounded-xl border border-border p-3">
                <input type="checkbox" checked={scopes.includes(scope.id)} onChange={(event) => setScopes((current) => event.target.checked ? [...current, scope.id] : current.filter((value) => value !== scope.id))} className="mt-1 accent-[var(--color-brand)]" />
                <span><span className="block text-sm font-medium text-foreground">{scope.label}</span><span className="block text-xs text-muted">{scope.detail}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" disabled={creating || !name.trim() || scopes.length === 0} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Generate API key
        </button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-5 py-4"><h3 className="font-semibold text-foreground">Your keys</h3></div>
        {loading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div> : keys.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">No API keys yet. Generate one to connect an integration.</p>
        ) : <ul className="divide-y divide-border">
          {keys.map((key) => {
            const expired = key.expires_at !== null && new Date(key.expires_at) <= new Date();
            const inactive = Boolean(key.revoked_at) || expired;
            return <li key={key.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-foreground">{key.name}</span><span className={`rounded-full px-2 py-0.5 text-xs ${inactive ? "bg-border text-muted" : "bg-green-500/10 text-green-400"}`}>{key.revoked_at ? "Revoked" : expired ? "Expired" : "Active"}</span></div>
                <p className="mt-1 font-mono text-xs text-muted">{key.key_prefix}••••••••</p>
                <div className="mt-3 flex flex-wrap gap-1.5">{key.scopes.map((scope) => <span key={scope} className="rounded-md bg-background px-2 py-1 text-xs text-muted">{scope}</span>)}</div>
                <p className="mt-3 text-xs text-muted">Created {formatDate(key.created_at)} · Last used {formatDate(key.last_used_at)}{key.expires_at ? ` · Expires ${formatDate(key.expires_at)}` : " · No expiry"}</p>
              </div>
              {!inactive && <button type="button" onClick={() => void revokeKey(key)} disabled={revoking === key.id} className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50" aria-label={`Revoke ${key.name}`}>
                {revoking === key.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}Revoke
              </button>}
              {inactive && key.revoked_at && <span className="inline-flex items-center gap-1 self-start text-xs text-muted"><Check className="h-4 w-4" />Revoked {formatDate(key.revoked_at)}</span>}
            </li>;
          })}
        </ul>}
      </div>
    </section>
  );
}
