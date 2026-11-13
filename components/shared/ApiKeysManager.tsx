/**
 * API key management for the MCP server (design §6.2).
 * Rendered on the profile edit page ("profile settings").
 *
 * - Create: name + optional mcp:draft scope. The raw key is shown
 *   ONCE, in a copyable box — after that it can never be retrieved
 *   again (only the hash is stored). Copy it before closing the box.
 * - List: masked keys (keyPrefix only), scopes, expiry, last use.
 * - Revoke: immediate; the key stops working on the next call.
 */
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKeyListItem,
} from "@/lib/actions/api-key.action";

export default function ApiKeysManager() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKeyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [allowDraft, setAllowDraft] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function refresh() {
    const result = await listApiKeys();
    if (result.success && result.keys) {
      setKeys(result.keys);
    } else {
      toast({ title: "Could not load API keys", variant: "destructive" });
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    if (!name.trim()) {
      toast({ title: "Give the key a name first", variant: "destructive" });
      return;
    }
    setCreating(true);
    const result = await createApiKey({ name: name.trim(), allowDraft });
    setCreating(false);
    if (!result.success || !result.key) {
      toast({
        title: "Could not create API key",
        description: result.error,
        variant: "destructive",
      });
      return;
    }
    setNewKey(result.key);
    setName("");
    setAllowDraft(false);
    await refresh();
  }

  async function handleRevoke(keyId: string) {
    setRevokingId(keyId);
    const result = await revokeApiKey({ keyId });
    setRevokingId(null);
    if (!result.success) {
      toast({
        title: "Could not revoke API key",
        description: result.error,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "API key revoked" });
    await refresh();
  }

  async function copyKey() {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      toast({ title: "API key copied to clipboard" });
    } catch {
      toast({ title: "Copy failed — select the key and copy it manually" });
    }
  }

  return (
    <div className="mt-9">
      <h2 className="h2-bold text-dark100_light900">API Keys (MCP)</h2>
      <p className="paragraph-regular mt-2 text-dark500_light700">
        Keys let external agents (Claude Desktop, IDE agents) call Dev
        Overflow over MCP at <code>/api/mcp</code>. A key can read
        questions, tags and public user stats; with the draft scope it can
        also create answer drafts for human review. Keys never publish,
        vote or change reputation.
      </p>

      {newKey && (
        <div className="background-light800_dark300 mt-5 rounded-md border border-green-500 p-4">
          <p className="body-bold text-dark100_light900">
            Copy your new key now — this is the only time it is shown.
          </p>
          <code className="mt-2 block break-all rounded bg-black/10 p-2 text-sm dark:bg-white/10">
            {newKey}
          </code>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={copyKey}>
              Copy key
            </Button>
            <Button size="sm" variant="outline" onClick={() => setNewKey(null)}>
              I saved it
            </Button>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="api-key-name" className="paragraph-semibold text-dark400_light800">
            Key name
          </label>
          <Input
            id="api-key-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Claude Desktop"
            maxLength={100}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-dark400_light800">
          <input
            type="checkbox"
            checked={allowDraft}
            onChange={(e) => setAllowDraft(e.target.checked)}
          />
          Allow creating answer drafts (mcp:draft)
        </label>
        <Button onClick={handleCreate} disabled={creating}>
          {creating ? "Creating…" : "Create key"}
        </Button>
      </div>

      {loading ? (
        <p className="paragraph-regular mt-5 text-dark500_light700">
          Loading keys…
        </p>
      ) : keys.length === 0 ? (
        <p className="paragraph-regular mt-5 text-dark500_light700">
          No API keys yet.
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {keys.map((key) => {
            const expired = new Date(key.expiresAt).getTime() <= Date.now();
            const revoked = Boolean(key.revokedAt);
            return (
              <li
                key={key.id}
                className="background-light800_dark300 flex flex-col gap-2 rounded-md p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="body-bold text-dark100_light900">
                    {key.name}{" "}
                    <span className="body-regular text-dark500_light700">
                      {key.keyPrefix}…
                    </span>
                  </p>
                  <p className="small-regular text-dark500_light700">
                    Scopes: {key.scopes.join(", ")} · Created{" "}
                    {new Date(key.createdAt).toLocaleDateString()} · Expires{" "}
                    {new Date(key.expiresAt).toLocaleDateString()}
                    {key.lastUsedAt
                      ? ` · Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`
                      : " · Never used"}
                  </p>
                  {revoked && (
                    <p className="small-regular text-red-500">Revoked</p>
                  )}
                  {!revoked && expired && (
                    <p className="small-regular text-red-500">Expired</p>
                  )}
                </div>
                {!revoked && !expired && (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={revokingId === key.id}
                    onClick={() => handleRevoke(key.id)}
                  >
                    {revokingId === key.id ? "Revoking…" : "Revoke"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
