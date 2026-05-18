// Brief #23 Phase C — Destiny-native armor rules list. Outer Panel chrome
// + ticks come from Settings.tsx's Armor tab; this file is just header +
// row list (no inner card wrapper).

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
import { BracketBtn, Btn, Headline, SectionHead, Toggle } from '@/components/destiny';

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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Headline size="sm">Armor Rules</Headline>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-d-9 uppercase tracking-d-wide text-d-text-sec">
              Auto-Lock on Match
            </span>
            <Toggle
              on={autoLockOnArmorMatch}
              onToggle={() => onAutoLockToggle(!autoLockOnArmorMatch)}
              ariaLabel="Auto-lock on armor match"
            />
          </div>
          <BracketBtn small onClick={() => setEditor({ mode: 'edit', rule: blankRule() })}>
            New Rule
          </BracketBtn>
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="text-d-11 text-d-text-muted text-center py-8">
          No armor rules yet. Create one to start catching keeper drops.
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-d-hairline border-y border-d-hairline">
          {rules.map((rule) => (
            <li key={rule.id} className="py-3 px-2 flex items-center gap-3 hover:bg-d-bg-hover transition-colors duration-d-fast">
              <Toggle
                on={rule.enabled}
                onToggle={() => handleToggleEnabled(rule.id)}
                ariaLabel="Rule enabled"
              />
              <div className="flex-1 min-w-0">
                <div
                  className={`text-d-13 truncate ${
                    rule.enabled ? 'text-d-text' : 'text-d-text-muted'
                  }`}
                >
                  {rule.name || summarizeRule(rule)}
                </div>
                {rule.name && (
                  <div className="text-d-10 text-d-text-muted truncate font-mono">
                    {summarizeRule(rule)}
                  </div>
                )}
              </div>
              <Btn variant="ghost" small onClick={() => setEditor({ mode: 'edit', rule })}>
                Edit
              </Btn>
              <Btn variant="danger" small onClick={() => handleDelete(rule.id)}>
                Delete
              </Btn>
            </li>
          ))}
        </ul>
      )}
      <SectionHead>{rules.length} {rules.length === 1 ? 'rule' : 'rules'}</SectionHead>
    </div>
  );
}
