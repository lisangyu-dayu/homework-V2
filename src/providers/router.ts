import { loadConfig } from '@/lib/config';
import { ClaudeProvider } from './claude';
import { CodexProvider } from './codex';
import type { LLMProvider, ProviderName, TaskKind } from './types';

const taskPreference: Record<TaskKind, ProviderName[]> = {
  vision:                ['claude', 'codex'],
  layoutSplit:           ['claude'],
  parseQuestion:         ['claude'],
  selfSolve:             ['codex', 'claude'],
  extractStudentAnswer:  ['claude'],
  generateExplanation:   ['claude', 'codex'],
  kpTagging:             ['claude'],
};

let singletons: Record<ProviderName, LLMProvider> | null = null;

function getSingletons() {
  if (singletons) return singletons;
  const cfg = loadConfig();
  singletons = {
    claude: new ClaudeProvider(cfg.anthropicApiKey, cfg.anthropicModel),
    codex: new CodexProvider({
      cliPath: cfg.codexCliPath,
      defaultModel: cfg.codexDefaultModel,
      timeoutMs: cfg.codexTimeoutMs,
    }),
  };
  return singletons;
}

export interface PickOptions {
  task: TaskKind;
  override?: ProviderName;
}

export function pickProvider(opts: PickOptions): LLMProvider {
  const pool = getSingletons();
  if (opts.override) return pool[opts.override];

  const envOverride = process.env[`PROVIDER_OVERRIDE_${opts.task.toUpperCase()}`] as ProviderName | undefined;
  if (envOverride && envOverride in pool) return pool[envOverride];

  const candidates = taskPreference[opts.task] ?? ['claude'];
  const primary = candidates[0] ?? 'claude';
  return pool[primary];
}

export function pickFallback(task: TaskKind, failed: ProviderName): LLMProvider | null {
  const pool = getSingletons();
  const candidates = taskPreference[task] ?? [];
  const next = candidates.find((p) => p !== failed);
  return next ? pool[next] : null;
}
