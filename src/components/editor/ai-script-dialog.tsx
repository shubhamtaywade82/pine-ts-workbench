"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2, Check, AlertCircle, Wand2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export interface AiScriptDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly currentCode: string;
  readonly currentError: string | null;
  readonly onApplyCode: (code: string) => void;
}

interface AgentResponse {
  readonly ok: boolean;
  readonly code?: string;
  readonly explanation?: string;
  readonly iterations?: number;
  readonly error?: string;
}

export function AiScriptDialog({
  isOpen,
  onClose,
  currentCode,
  currentError,
  onApplyCode,
}: AiScriptDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("minicpm5-toolagent:latest");
  const [models, setModels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AgentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setResult(null);
    setError(null);
    if (currentError) {
      setPrompt(`Fix the following compile or runtime error in this script: ${currentError}`);
    } else if (prompt === "") {
      setPrompt("Add an RSI filter (length 14) and only plot or enter when RSI is in a favourable zone.");
    }
    fetchModels(setModels, setModel);
  }, [isOpen, currentError]);

  const handleSubmit = async () => {
    if (!prompt.trim() || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await callAgent({ prompt, currentCode, currentError, model });
      if (res.ok) {
        setResult(res);
      } else {
        setError(res.error ?? "Failed to generate script");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = () => {
    if (result?.code) {
      onApplyCode(result.code);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl bg-popover text-foreground border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-5 w-5 text-indigo-400" />
            Pine Script AI Copilot & Self-Healing Agent
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Describe your script requirements or let the agent diagnose and repair runtime errors.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {currentError && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/15 p-2 text-xs text-destructive border border-destructive/30">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Detected Error: </span>
                <span>{currentError}</span>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="prompt" className="text-xs font-medium text-muted-foreground">
              Instruction or Fix Prompt
            </label>
            <Textarea
              id="prompt"
              rows={3}
              placeholder="What would you like the agent to build, optimize, or fix?"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="resize-none bg-background text-sm"
              disabled={isLoading}
            />
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>Model:</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none"
                disabled={isLoading}
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            {result?.iterations && (
              <span className="text-[11px] text-emerald-400">
                Self-healed & validated in {result.iterations} iterations
              </span>
            )}
          </div>

          {error && <div className="text-xs text-destructive">{error}</div>}

          {result?.code && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Validated Script Output</span>
              <pre className="max-h-48 overflow-y-auto rounded bg-background p-2 text-xs font-mono text-emerald-300">
                {result.code}
              </pre>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSubmit}
              disabled={isLoading || !prompt.trim()}
              className="gap-1.5"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Self-healing...
                </>
              ) : (
                <>
                  <Wand2 className="h-3.5 w-3.5" />
                  Run Agent
                </>
              )}
            </Button>
            {result?.code && (
              <Button size="sm" onClick={handleApply} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                <Check className="h-3.5 w-3.5" />
                Apply to Editor
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function fetchModels(setModels: (models: string[]) => void, setModel: (model: string) => void) {
  try {
    const res = await fetch("/api/ai/script-agent");
    if (!res.ok) return;
    const data = (await res.json()) as { models?: string[]; defaultModel?: string };
    if (data.models && data.models.length > 0) {
      setModels(data.models);
      if (data.defaultModel) setModel(data.defaultModel);
    }
  } catch {
    // Model fetch fails silently when server offline.
  }
}

async function callAgent(payload: {
  prompt: string;
  currentCode: string;
  currentError: string | null;
  model: string;
}): Promise<AgentResponse> {
  const res = await fetch("/api/ai/script-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: payload.prompt,
      currentCode: payload.currentCode,
      error: payload.currentError ?? undefined,
      model: payload.model,
    }),
  });
  return (await res.json()) as AgentResponse;
}
