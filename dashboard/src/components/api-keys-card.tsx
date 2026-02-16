import * as React from "react";
import { KeyIcon, PlusIcon, Trash2Icon, CopyIcon, CheckIcon, ShieldCheckIcon, ShieldOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { ApiKeyView } from "@/types";

interface ApiKeysCardProps {
  keys: ApiKeyView[];
  onCreateKey: (name: string) => Promise<ApiKeyView | null>;
  onDeleteKey: (id: string) => Promise<void>;
  onReload: () => void;
}

export function ApiKeysCard({ keys, onCreateKey, onDeleteKey, onReload }: ApiKeysCardProps) {
  const [createOpen, setCreateOpen] = React.useState(false);
  const [keyName, setKeyName] = React.useState("");
  const [newKey, setNewKey] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  async function handleCreate() {
    if (!keyName.trim()) return;
    setCreating(true);
    const result = await onCreateKey(keyName.trim());
    setCreating(false);
    if (result?.key) {
      setNewKey(result.key);
      setKeyName("");
    } else {
      setCreateOpen(false);
      setKeyName("");
    }
  }

  function handleCopy() {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleClose() {
    setCreateOpen(false);
    setNewKey(null);
    setKeyName("");
    setCopied(false);
    onReload();
  }

  const authEnabled = keys.length > 0;

  return (
    <div className="rounded-lg border p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">API Keys</h3>
          {authEnabled ? (
            <Badge variant="outline" className="text-xs border-green-300 text-green-700 dark:border-green-800 dark:text-green-400">
              <ShieldCheckIcon className="size-3 mr-1" />
              Auth enabled
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs border-yellow-300 text-yellow-700 dark:border-yellow-800 dark:text-yellow-400">
              <ShieldOffIcon className="size-3 mr-1" />
              Open access
            </Badge>
          )}
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="size-3.5" />
          Create API Key
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {authEnabled
          ? "API endpoints require authentication. Use Bearer token in the Authorization header."
          : "No API keys created. All endpoints are currently open. Create a key to enable authentication."
        }
      </p>

      {keys.length > 0 ? (
        <div className="space-y-2">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between rounded-md border px-3 py-2">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">{k.name}</span>
                <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{k.key_prefix}</code>
              </div>
              <div className="flex items-center gap-3">
                {k.last_used_at && (
                  <span className="text-xs text-muted-foreground">
                    Last used {new Date(k.last_used_at).toLocaleDateString()}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {new Date(k.created_at).toLocaleDateString()}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0 text-destructive hover:text-destructive"
                  onClick={() => onDeleteKey(k.id)}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-4 text-center">
          <p className="text-sm text-muted-foreground">
            No API keys yet.{" "}
            <button
              onClick={() => setCreateOpen(true)}
              className="underline underline-offset-4 hover:text-foreground"
            >
              Click here to generate your first API key.
            </button>
          </p>
        </div>
      )}

      {/* Connect info */}
      {authEnabled && (
        <div className="rounded-md bg-muted/50 p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Connect</p>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground w-14">API URL</span>
            <code className="bg-muted px-2 py-0.5 rounded text-xs">http://localhost:{window.location.port}/api</code>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground w-14">Header</span>
            <code className="bg-muted px-2 py-0.5 rounded text-xs">Authorization: Bearer YOUR_API_KEY</code>
          </div>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) handleClose(); else setCreateOpen(true); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{newKey ? "API Key Created" : "Create API Key"}</DialogTitle>
          </DialogHeader>

          {newKey ? (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Copy your API key now. You won&apos;t be able to see it again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-sm font-mono break-all">
                  {newKey}
                </code>
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? <CheckIcon className="size-3.5 text-green-500" /> : <CopyIcon className="size-3.5" />}
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={handleClose}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="grid gap-2">
                <label htmlFor="key-name" className="text-sm font-medium">Name</label>
                <Input
                  id="key-name"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="e.g. Production, Development"
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={handleClose}>Cancel</Button>
                <Button onClick={handleCreate} disabled={!keyName.trim() || creating}>
                  {creating ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
