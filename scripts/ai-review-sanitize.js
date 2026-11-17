#!/usr/bin/env node
// Output hygiene for AI reviewer text that is forwarded to other systems (GitHub job
// summary, Slack, email, webhook payloads).
//
// The reviewer model reads untrusted diffs, so everything it returns is untrusted data:
// it can carry Slack mentions, HTML, markdown links or images, or workflow-command text.
// Every sink in .github/workflows/ai-reviewer.yml goes through this module so that text
// is escaped, mention-stripped, length-capped, and labelled as AI-generated advisory output.

'use strict';

const AI_ADVISORY_LABEL =
  'AI-generated advisory output. Unverified and may be wrong. Not a required check.';

const MAX_SUMMARY_CHARS = 500;
const MAX_ISSUE_MESSAGE_CHARS = 300;
const MAX_FILE_CHARS = 200;
const MAX_TITLE_CHARS = 120;
const MAX_STRIP_PASSES = 5;

const VERDICTS = Object.freeze(['APPROVE', 'REQUEST_CHANGES', 'ERROR', 'SKIPPED']);

const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0080-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

function toText(value) {
  return value === undefined || value === null ? '' : String(value);
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Removes Slack special mentions (`<!channel>`, `<!here>`, `<!everyone>`, `<!subteam^...>`),
 * Slack user/channel references (`<@U1>`, `<#C1>`), bare `@channel`/`@here`/`@everyone`, and
 * every other `@name` or `@org/team` mention. Runs to a fixed point so nested payloads such as
 * `<<!channel>!here>` cannot reassemble into a live token.
 */
function stripMentions(text) {
  let current = toText(text);
  for (let pass = 0; pass < MAX_STRIP_PASSES; pass += 1) {
    const next = current
      .replace(/<![^>]*>/g, '')
      .replace(/<[@#][^>]*>/g, '')
      .replace(/@(?:channel|here|everyone)\b/gi, '')
      .replace(/(^|[^A-Za-z0-9_.\/-])@[A-Za-z0-9_][A-Za-z0-9_.\/-]*/g, '$1')
      .replace(/^@[A-Za-z0-9_][A-Za-z0-9_.\/-]*/, '');
    if (next === current) break;
    current = next;
  }
  return current.replace(/@(?=[A-Za-z0-9_])/g, '(at)');
}

function escapeAngleAndAmp(text) {
  return toText(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(text, maxChars) {
  if (!Number.isFinite(maxChars) || maxChars <= 0 || text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const last = cut.charCodeAt(cut.length - 1);
  const safe = last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
  return `${safe}...`;
}

/**
 * Full pipeline for one piece of model-controlled text: strip control and bidi characters,
 * collapse to a single line, strip mentions, cap the length, then escape `& < >`.
 */
function sanitizeAiText(value, options = {}) {
  const maxChars = options.maxChars === undefined ? MAX_ISSUE_MESSAGE_CHARS : options.maxChars;
  const cleaned = collapseWhitespace(toText(value).replace(CONTROL_CHARS_RE, ' '));
  const stripped = collapseWhitespace(stripMentions(cleaned));
  return escapeAngleAndAmp(truncate(stripped, maxChars));
}

/** Extra escaping for GitHub-flavoured markdown sinks (job summary). */
function escapeMarkdownInline(escapedText) {
  return toText(escapedText)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, "'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/!(?=\\\[)/g, '\\!')
    .replace(/\|/g, '\\|');
}

function sanitizeLocation(file, line) {
  const safeFile = sanitizeAiText(file, { maxChars: MAX_FILE_CHARS }) || 'unknown';
  return Number.isInteger(line) && line >= 1 ? `${safeFile}:${line}` : safeFile;
}

function normalizeVerdict(raw) {
  const v = collapseWhitespace(toText(raw));
  return VERDICTS.includes(v) ? v : 'ERROR';
}

function parseIssues(rawJson, maxIssues = 25) {
  let parsed = [];
  try {
    parsed = JSON.parse(toText(rawJson) || '[]');
  } catch (_) {
    parsed = [];
  }
  if (!Array.isArray(parsed)) return [];
  const issues = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    issues.push({
      file: toText(item.file),
      line: typeof item.line === 'number' ? item.line : undefined,
      message: toText(item.message),
    });
    if (issues.length >= maxIssues) break;
  }
  return issues;
}

function safeHttpsUrl(value) {
  const url = toText(value).trim();
  return /^https:\/\/[^\s<>|"'`]+$/.test(url) ? url : '';
}

function defaultSummary(verdict) {
  return verdict === 'REQUEST_CHANGES'
    ? 'The AI Reviewer requested changes.'
    : 'The Trimurti AI Reviewer pipeline failed closed before producing a review verdict.';
}

/** Markdown for $GITHUB_STEP_SUMMARY. */
function buildSummaryMarkdown({ verdict, summary, issues = [], totalIssuesCount } = {}) {
  const safeVerdict = normalizeVerdict(verdict);
  const total = Number.isInteger(totalIssuesCount) ? totalIssuesCount : issues.length;
  const lines = [
    `### Trimurti AI Review: ${safeVerdict}`,
    '',
    `> **${AI_ADVISORY_LABEL}**`,
    '',
    escapeMarkdownInline(
      sanitizeAiText(summary, { maxChars: MAX_SUMMARY_CHARS }) || 'No summary provided.'
    ),
  ];
  if (issues.length > 0) {
    lines.push('', '#### Issues (AI-generated, unverified)', '');
    for (const issue of issues) {
      const loc = escapeMarkdownInline(sanitizeLocation(issue.file, issue.line));
      const message = escapeMarkdownInline(sanitizeAiText(issue.message));
      lines.push(`- \`${loc}\`: ${message}`);
    }
    if (total > issues.length) {
      lines.push('', `_Showing first ${issues.length} of ${total} issues._`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function normalizeNotificationInput(input = {}) {
  const verdict = normalizeVerdict(input.verdict);
  const summary =
    sanitizeAiText(input.summary, { maxChars: MAX_SUMMARY_CHARS }) || defaultSummary(verdict);
  return {
    verdict,
    summary,
    issues: Array.isArray(input.issues) ? input.issues : [],
    repo: sanitizeAiText(input.repo, { maxChars: MAX_TITLE_CHARS }),
    num: sanitizeAiText(input.num, { maxChars: 20 }) || '?',
    title: sanitizeAiText(input.title, { maxChars: MAX_TITLE_CHARS }),
    prUrl: safeHttpsUrl(input.prUrl),
    runUrl: safeHttpsUrl(input.runUrl),
  };
}

/** JSON body for a Slack incoming webhook (mentions stripped, unfurling disabled). */
function buildSlackPayload(input = {}) {
  const n = normalizeNotificationInput(input);
  const issueLines = n.issues.slice(0, 10).map((issue) => {
    const loc = sanitizeLocation(issue.file, issue.line).replace(/`/g, "'");
    return `- \`${loc}\`: ${sanitizeAiText(issue.message)}`;
  });
  if (n.issues.length > 10) {
    issueLines.push(`- ...and ${n.issues.length - 10} additional issue(s)`);
  }
  const lines = [
    `*AI PR Review Failed* (${n.repo} #${n.num})`,
    `_${AI_ADVISORY_LABEL}_`,
    n.title ? `PR: ${n.title}` : null,
    `Verdict: \`${n.verdict}\``,
    `Summary (AI-generated): ${n.summary}`,
    issueLines.length > 0 ? `Issues (AI-generated):\n${issueLines.join('\n')}` : null,
    n.prUrl ? `View details here: <${n.prUrl}>` : null,
    n.runUrl ? `Workflow run: <${n.runUrl}>` : null,
  ].filter(Boolean);
  return {
    text: lines.join('\n'),
    unfurl_links: false,
    unfurl_media: false,
  };
}

/** Subject and plain-text body for the email notification. */
function buildEmailMessage(input = {}) {
  const n = normalizeNotificationInput(input);
  const bodyLines = [
    `The Trimurti AI Reviewer failed on ${n.repo} Pull Request #${n.num}.`,
    AI_ADVISORY_LABEL,
    n.title ? `Title: ${n.title}` : null,
    `Verdict: ${n.verdict}`,
    '',
    `Summary (AI-generated): ${n.summary}`,
  ];
  if (n.issues.length > 0) {
    bodyLines.push('', 'Issues (AI-generated, unverified):');
    for (const issue of n.issues) {
      bodyLines.push(`- ${sanitizeLocation(issue.file, issue.line)}: ${sanitizeAiText(issue.message)}`);
    }
  }
  bodyLines.push('', n.prUrl ? `Pull Request: ${n.prUrl}` : null, n.runUrl ? `Workflow Run: ${n.runUrl}` : null);
  return {
    subject: `Build Failed: PR #${n.num}${n.title ? ` - ${n.title.slice(0, 80)}` : ''}`,
    body: bodyLines.filter((v) => v !== null).join('\n'),
  };
}

/** Versioned JSON payload for the optional generic webhook. */
function buildWebhookPayload(input = {}) {
  const n = normalizeNotificationInput(input);
  return {
    schema: 'trimurti.ai_review.v1',
    ai_generated: true,
    advisory: true,
    notice: AI_ADVISORY_LABEL,
    verdict: n.verdict,
    summary: n.summary,
    issues: n.issues.map((issue) => {
      const entry = {
        file: sanitizeAiText(issue.file, { maxChars: MAX_FILE_CHARS }) || 'unknown',
        message: sanitizeAiText(issue.message),
      };
      if (Number.isInteger(issue.line) && issue.line >= 1) entry.line = issue.line;
      return entry;
    }),
    repository: n.repo,
    pull_request: { number: Number(n.num) || null, title: n.title, url: n.prUrl },
    workflow_run_url: n.runUrl,
  };
}

const EMAIL_ADDRESS_RE = /^[^\s@<>,;"'()\[\]\\]+@[^\s@<>,;"'()\[\]\\]+\.[^\s@<>,;"'()\[\]\\]+$/;

/** Splits a comma-separated recipient list, dropping blanks, duplicates, and malformed values. */
function parseEmailList(raw) {
  const seen = new Set();
  const out = [];
  for (const part of toText(raw).split(',')) {
    const email = part.trim();
    const key = email.toLowerCase();
    if (!email || seen.has(key) || !EMAIL_ADDRESS_RE.test(email)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

module.exports = {
  AI_ADVISORY_LABEL,
  MAX_SUMMARY_CHARS,
  MAX_ISSUE_MESSAGE_CHARS,
  stripMentions,
  escapeAngleAndAmp,
  escapeMarkdownInline,
  sanitizeAiText,
  sanitizeLocation,
  normalizeVerdict,
  parseIssues,
  parseEmailList,
  safeHttpsUrl,
  buildSummaryMarkdown,
  buildSlackPayload,
  buildEmailMessage,
  buildWebhookPayload,
};
