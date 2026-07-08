import type { Category, Flow, Status } from './types';

export const CATEGORY_LABEL: Record<string, string> = {
  locator_drift: 'Locator drift',
  out_of_scope: 'Out of scope',
  product_bug: 'Product bug',
  flaky: 'Flaky',
  polish: 'Polish',
  pending: 'Pending',
  timing: 'Timing',
  weakens_assertion: 'Weakens assertion',
  assertion_broken: 'Assertion broken',
  infra: 'Infra',
  unknown: 'Unknown',
};

export function categoryLabel(category: Category): string {
  if (!category) return '—';
  return CATEGORY_LABEL[category] || category;
}

interface Meta {
  label: string;
  fg: string;
  bg: string;
}

export const STATUS_META: Record<Status, Meta> = {
  created: { label: 'Created', fg: '#6B7280', bg: '#EEF0F2' },
  running: { label: 'Running', fg: '#2563EB', bg: '#DBEAFE' },
  accepted: { label: 'Accepted', fg: '#16A34A', bg: '#DCFCE7' },
  rejected: { label: 'Rejected', fg: '#DC2626', bg: '#FEE2E2' },
  applied: { label: 'Applied', fg: '#7C6CF6', bg: '#EEEBFE' },
};

export const FLOW_META: Record<Flow, Meta> = {
  add: { label: 'Add', fg: '#0891B2', bg: '#CFFAFE' },
  heal: { label: 'Heal', fg: '#D97706', bg: '#FEF3C7' },
  improve: { label: 'Improve', fg: '#7C6CF6', bg: '#EEEBFE' },
  batch: { label: 'Batch', fg: '#DB2777', bg: '#FCE7F3' },
  steward: { label: 'Steward', fg: '#16A34A', bg: '#DCFCE7' },
  quarantine: { label: 'Quarantine', fg: '#0E7C7B', bg: '#CCFBF1' },
  onboard: { label: 'Onboard', fg: '#6B7280', bg: '#EEF0F2' },
  analyze: { label: 'Analyze', fg: '#7C3AED', bg: '#EDE9FE' },
};

export const HEALTH_META: Record<'green' | 'amber' | 'red', Meta & { label: string }> = {
  green: { label: 'Healthy', fg: '#16A34A', bg: '#DCFCE7' },
  amber: { label: 'Needs attention', fg: '#D97706', bg: '#FEF3C7' },
  red: { label: 'Broken', fg: '#DC2626', bg: '#FEE2E2' },
};

export const ACCENT_COLOR = '#6D5EF0';
