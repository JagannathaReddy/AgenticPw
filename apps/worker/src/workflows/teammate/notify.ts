import type { TeammateEscalation } from '@poc/types';

export interface TeammateNotifyPayload {
  repoName: string;
  title: string;
  assignmentType: string;
  assignmentId: string;
  manifestId: string;
  reportStatus: string;
  summary: string;
  escalations: TeammateEscalation[];
  totalCostUSD: number;
  source?: string;
}

function statusEmoji(reportStatus: string): string {
  if (reportStatus === 'done') return '✅';
  if (reportStatus === 'partial') return '⚠️';
  return '🚨';
}

export function formatTeammateWebhookBody(payload: TeammateNotifyPayload): { text: string } {
  const icon = statusEmoji(payload.reportStatus);
  const lines = [
    `${icon} *Teammate ${payload.reportStatus}* — ${payload.repoName}`,
    `*${payload.title}* (${payload.assignmentType})`,
    payload.summary,
    `Cost: $${payload.totalCostUSD.toFixed(4)} · manifest \`${payload.manifestId.slice(0, 8)}\``,
  ];
  if (payload.escalations.length > 0) {
    const esc = payload.escalations[0];
    lines.push(`Escalation: *${esc.category}* — ${esc.reason}`);
  }
  if (payload.source && payload.source !== 'human') {
    lines.push(`Source: ${payload.source}`);
  }
  return { text: lines.join('\n') };
}

export async function postTeammateWebhook(webhookUrl: string, payload: TeammateNotifyPayload): Promise<void> {
  const body = formatTeammateWebhookBody(payload);
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Webhook POST ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
