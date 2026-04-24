import { loadConfig } from '@/lib/config';
import { ClaudeCliProvider } from './claude';
import { CodexCliProvider } from './codex';
import type { LLMProvider, ProviderName, TaskKind } from './types';

const taskPreference: Record<TaskKind, ProviderName[]> = {
  vision:                ['codex', 'claude'],
  layoutSplit:           ['codex', 'claude'],
  parseQuestion:         ['codex', 'claude'],
  selfSolve:             ['codex', 'claude'],
  extractStudentAnswer:  ['codex', 'claude'],
  generateExplanation:   ['codex', 'claude'],
  kpTagging:             ['codex', 'claude'],
};

let singletons: Record<ProviderName, LLMProvider> | null = null;

function getSingletons() {
  if (singletons) return singletons;
  const cfg = loadConfig();
  singletons = {
    claude: new ClaudeCliProvider({
      cliPath: cfg.claudeCliPath,
      defaultModel: cfg.claudeDefaultModel,
      poolSize: cfg.claudePoolSize,
      timeoutMs: cfg.claudeTimeoutMs,
    }),
    codex: new CodexCliProvider({
      cliPath: cfg.codexCliPath,
      defaultModel: cfg.codexDefaultModel,
      poolSize: cfg.codexPoolSize,
      timeoutMs: cfg.codexTimeoutMs,
    }),
  };
  return singletons;
}

export interface PickOptions {
  task: TaskKind;
  override?: ProviderName;
}

function getCandidates(task: TaskKind, override?: ProviderName): ProviderName[] {
  if (override) {
    return [override];
  }

  const envOverride = process.env[`PROVIDER_OVERRIDE_${task.toUpperCase()}`] as ProviderName | undefined;
  if (envOverride) {
    return [envOverride];
  }

  return taskPreference[task] ?? ['claude'];
}

export function pickProvider(opts: PickOptions): LLMProvider {
  const pool = getSingletons();
  const candidates = getCandidates(opts.task, opts.override);

  for (const candidate of candidates) {
    const provider = pool[candidate];
    if (opts.task !== 'vision' || provider.supportsVision) {
      return provider;
    }
  }

  const primary = candidates[0] ?? 'claude';
  return pool[primary];
}

export function pickFallback(task: TaskKind, failed: ProviderName): LLMProvider | null {
  const pool = getSingletons();
  const candidates = getCandidates(task);

  for (const candidate of candidates) {
    if (candidate === failed) {
      continue;
    }

    const provider = pool[candidate];
    if (task === 'vision' && !provider.supportsVision) {
      continue;
    }

    return provider;
  }

  return null;
}

export function resetProviderSingletonsForTest(): void {
  singletons = null;
}
