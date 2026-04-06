#!/usr/bin/env node
/**
 * fred-ai eval — Runs 10 test questions against Gemini API
 * and scores responses by expected keyword presence.
 *
 * Usage: node eval/run-evals.js
 * Requires: GEMINI_API_KEY env var or API_KEY in script
 *
 * Uses fred-context.local.md if present (recommended for real CV facts); else fred-context.md (public stub — keyword checks may fail).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
/** Prefer gitignored fred-context.local.md; fallback to public stub. */
const CONTEXT_PATH = existsSync(join(ROOT, 'fred-context.local.md'))
  ? join(ROOT, 'fred-context.local.md')
  : join(ROOT, 'fred-context.md');
const RESULTS_PATH = join(ROOT, 'eval', 'eval-results.md');

const API_KEY = process.env.GEMINI_API_KEY || 'YOUR_API_KEY';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

const testCases = [
  { q: "Where does Fred work?", expect: "Adobe" },
  { q: "What AI tools has Fred used?", expect: "Hugging Face" },
  { q: "Is Fred open to relocation?", expect: "Zurich" },
  { q: "What is Fred's strongest PM skill?", expect: "OKR" },
  { q: "Has Fred worked with LLMs?", expect: "LLM" },
  { q: "What did Fred study?", expect: "HSBA" },
  { q: "What is the arXiv project?", expect: "title" },
  { q: "What cloud platforms has Fred used?", expect: "AWS" },
  { q: "What is Fred's email?", expect: "frederik.niesner" },
  { q: "What is fred-ai?", expect: "assistant" },
];

function loadSystemPrompt() {
  return readFileSync(CONTEXT_PATH, 'utf-8');
}

async function askGemini(question, systemPrompt) {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: question }] }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `API error ${res.status}`);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function checkPass(response, expected) {
  const normalized = (response || '').toLowerCase();
  const keyword = expected.toLowerCase();
  return normalized.includes(keyword);
}

async function runEvals() {
  if (API_KEY === 'YOUR_API_KEY') {
    console.error('Set GEMINI_API_KEY env var or update API_KEY in run-evals.js');
    process.exit(1);
  }

  const systemPrompt = loadSystemPrompt();
  const results = [];
  let passed = 0;

  console.log('Running 10 eval questions...\n');

  for (let i = 0; i < testCases.length; i++) {
    const { q, expect } = testCases[i];
    process.stdout.write(`  ${i + 1}. ${q} ... `);
    try {
      const response = await askGemini(q, systemPrompt);
      const pass = checkPass(response, expect);
      if (pass) {
        passed++;
        console.log('PASS');
      } else {
        console.log('FAIL');
      }
      results.push({ q, expect, response: response.slice(0, 200), pass });
    } catch (err) {
      console.log('ERROR');
      results.push({ q, expect, response: `Error: ${err.message}`, pass: false });
    }
  }

  const score = `${passed}/10`;
  console.log(`\nScore: ${score}\n`);

  const md = [
    '# fred-ai Eval Results',
    '',
    `**Date:** ${new Date().toISOString().slice(0, 10)}`,
    `**Score:** ${score}`,
    '',
    '| # | Question | Expected | Pass |',
    '|---|----------|----------|------|',
    ...results.map((r, i) =>
      `| ${i + 1} | ${r.q} | ${r.expect} | ${r.pass ? '✓' : '✗'} |`
    ),
    '',
    '## Sample Responses',
    '',
    ...results.map(
      (r, i) =>
        `### ${i + 1}. ${r.q}\n\n${(r.response || '').replace(/\n/g, ' ')}\n`
    ),
  ].join('\n');

  writeFileSync(RESULTS_PATH, md, 'utf-8');
  console.log(`Results saved to eval/eval-results.md`);
}

runEvals().catch((err) => {
  console.error(err);
  process.exit(1);
});
