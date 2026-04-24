import { useState } from 'react';
import {
  type ArmorRule,
  loadArmorRules,
  newRuleId,
  saveArmorRules,
  summarizeRule,
} from '@/core/rules/armor-rules';
import type { ArmorTaxonomyPayload } from '@/shared/types';
import { ArmorRuleEditor } from '../components/ArmorRuleEditor';

type EditorState =
  | { mode: 'list' }
  | { mode: 'edit'; rule: ArmorRule };

interface RulesPanelProps {
  taxonomy: ArmorTaxonomyPayload | null;
  autoLockOnArmorMatch: boolean;
  onAutoLockToggle: (next: boolean) => void;
}

function blankRule(): ArmorRule {
  return {
    id: newRuleId(),
    name: '',
    enabled: true,
    class: 'any',
    sets: [],
    archetypes: [],
    tertiaries: [],
    minTier: 5,
  };
}

export function RulesPanel({ taxonomy, autoLockOnArmorMatch, onAutoLockToggle }: RulesPanelProps) {
  const [rules, setRules] = useState<ArmorRule[]>(() => loadArmorRules());
  const [editor, setEditor] = useState<EditorState>({ mode: 'list' });

  // saveArmorRules writes through chrome.storage which the SW sees via the
  // global onChanged listener — no explicit broadcast needed (unlike Overwolf
  // where the background window didn't share storage with the settings window).
  const persist = (next: ArmorRule[]) => {
    setRules(next);
    saveArmorRules(next);
  };

  const handleSave = (rule: ArmorRule) => {
    const existingIdx = rules.findIndex((r) => r.id === rule.id);
    const next = [...rules];
    if (existingIdx >= 0) next[existingIdx] = rule;
    else next.push(rule);
    persist(next);
    setEditor({ mode: 'list' });
  };

  const handleDelete = (id: string) => {
    persist(rules.filter((r) => r.id !== id));
  };

  const handleToggleEnabled = (id: string) => {
    persist(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  };

  if (editor.mode === 'edit') {
    return (
      <ArmorRuleEditor
        rule={editor.rule}
        taxonomy={taxonomy}
        onSave={handleSave}
        onCancel={() => setEditor({ mode: 'list' })}
      />
    );
  }

  return (
    <div className="rounded-lg border border-bg-border bg-bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-base font-medium text-text-primary">Armor rules</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-text-muted">
            <input
              type="checkbox"
              checked={autoLockOnArmorMatch}
              onChange={(e) => onAutoLockToggle(e.target.checked)}
              className="accent-rahool-blue"
            />
            Auto-lock on match
          </label>
          <button
            onClick={() => setEditor({ mode: 'edit', rule: blankRule() })}
            className="px-3 py-1.5 text-sm rounded bg-rahool-blue/20 text-rahool-blue border border-rahool-blue/40 hover:bg-rahool-blue/30"
          >
            + New rule
          </button>
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="text-sm text-text-muted py-6 text-center">
          No armor rules yet. Create one to start catching keeper drops.
        </div>
      ) : (
        <ul className="divide-y divide-bg-border">
          {rules.map((rule) => (
            <li key={rule.id} className="py-2.5 flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-text-muted">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={() => handleToggleEnabled(rule.id)}
                  className="accent-rahool-blue"
                />
                <span className="sr-only">Enabled</span>
              </label>
              <div className="flex-1 min-w-0">
                <div className={`text-sm truncate ${rule.enabled ? 'text-text-primary' : 'text-text-muted'}`}>
                  {rule.name || summarizeRule(rule)}
                </div>
                {rule.name && (
                  <div className="text-xs text-text-muted truncate font-mono">
                    {summarizeRule(rule)}
                  </div>
                )}
              </div>
              <button
                onClick={() => setEditor({ mode: 'edit', rule })}
                className="px-2 py-1 text-xs rounded border border-bg-border text-text-muted hover:text-text-primary"
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(rule.id)}
                className="px-2 py-1 text-xs rounded border border-red-500/40 text-red-300 hover:bg-red-500/10"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
