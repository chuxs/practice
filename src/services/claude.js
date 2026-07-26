const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

/**
 * Daily set: 4 questions — easy/medium × javascript/nodejs.
 * SQL slots are paused for now.
 */
const SLOT_PLAN = [
  { difficulty: 'easy', topic: 'javascript' },
  { difficulty: 'easy', topic: 'nodejs' },
  { difficulty: 'medium', topic: 'javascript' },
  { difficulty: 'medium', topic: 'nodejs' },
  // { difficulty: 'hard', topic: 'javascript' },
  // { difficulty: 'hard', topic: 'nodejs' },
  // { difficulty: 'easy', topic: 'sql' },
  // { difficulty: 'hard', topic: 'sql' },
];

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes('your_anthropic')) {
    const err = new Error(
      'ANTHROPIC_API_KEY is missing. Copy .env.example to .env and add your key.'
    );
    err.status = 500;
    throw err;
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function buildPrompt(dateKey) {
  return `You are a senior coding instructor writing interview-style drills. Generate exactly 4 practice coding questions for date ${dateKey}.

Slots (in order):
1. easy / javascript
2. easy / nodejs
3. medium / javascript
4. medium / nodejs

Make every prompt HIGHLY descriptive. Each prompt MUST include all of these sections (plain text, use newlines):
1) Goal — one clear sentence of what to build
2) Requirements — numbered bullet list of exact behaviors / edge cases
3) Constraints — what they may/may not use (e.g. no external packages)
4) Examples — at least 2 worked examples with input AND expected output shown clearly
5) How to verify — short note telling them what to console.log / call so Run shows useful output

Topic guidance:
- JavaScript: language fundamentals (arrays, objects, closures, prototypes, this, async/await, promises, ES6+). Pure JS is fine; CommonJS module.exports is allowed.
- Node.js: core modules and runtime patterns (path, url, events, streams, Buffer, process, timers, HTTP basics without Express). Prefer problems that work with console.log demos. Do NOT require filesystem writes, network servers that must stay open, or packages outside Node core.

Rules:
- Answerable in one editor (function or short script).
- Vary concepts; do not repeat the same pattern across the 4 questions.
- starterCode: incomplete scaffold PLUS 2–4 commented or live demo console.log calls at the bottom so clicking Run produces visible output once the solution is filled in. Include module.exports for the main function when relevant.
- answer: complete correct solution including the same demo calls so Run prints the example results.
- explanation: 3–6 sentences teaching the key idea and why the approach works.
- Titles should be specific (not generic like "Array Challenge").

Return ONLY valid JSON (no markdown fences):
{
  "questions": [
    {
      "difficulty": "easy|medium",
      "topic": "javascript|nodejs",
      "title": "specific title",
      "prompt": "full multi-section problem statement",
      "starterCode": "scaffold with demo calls",
      "answer": "full solution with demo calls",
      "explanation": "teaching explanation"
    }
  ]
}`;
}

function normalizeGenerated(parsed) {
  const expected = SLOT_PLAN.length;
  if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length !== expected) {
    throw new Error(`Claude returned an unexpected question payload (expected ${expected})`);
  }

  return SLOT_PLAN.map((slot, index) => {
    const q = parsed.questions[index] || {};
    return {
      difficulty: slot.difficulty,
      topic: slot.topic,
      title: String(q.title || `${slot.difficulty} ${slot.topic}`).trim(),
      prompt: String(q.prompt || '').trim(),
      starterCode: String(q.starterCode || '').trim(),
      answer: String(q.answer || '').trim(),
      explanation: String(q.explanation || '').trim(),
      order: index + 1,
    };
  }).map((q) => {
    if (!q.prompt || !q.answer || !q.explanation) {
      throw new Error('Claude returned incomplete question fields');
    }
    if (q.prompt.length < 180) {
      throw new Error('Claude returned a prompt that is too short / not descriptive enough');
    }
    return q;
  });
}

function extractText(response) {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function parseJsonFromText(text) {
  let jsonText = text;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim();
  }
  try {
    return JSON.parse(jsonText);
  } catch {
    throw new Error('Failed to parse Claude JSON response');
  }
}

async function generateDailyQuestions(dateKey) {
  const client = getClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 10000,
    messages: [{ role: 'user', content: buildPrompt(dateKey) }],
  });

  const parsed = parseJsonFromText(extractText(response));
  return normalizeGenerated(parsed);
}

/**
 * Grade a learner's submission against the prompt and reference answer.
 * Accepts correct solutions that differ in style but match the requirements.
 */
async function gradeSubmission(question, code) {
  const client = getClient();
  const submission = String(code || '').trim();

  if (!submission) {
    return {
      correct: false,
      feedback: 'Your editor is empty. Write a solution, then run Test code again.',
    };
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    messages: [
      {
        role: 'user',
        content: `You are a strict but fair coding grader for a practice platform.

Topic: ${question.topic}
Difficulty: ${question.difficulty}
Title: ${question.title}

PROBLEM:
${question.prompt}

REFERENCE SOLUTION (for your eyes only — do not quote it wholesale in feedback):
${question.answer}

LEARNER SUBMISSION:
${submission}

Grade whether the submission correctly solves the problem.
- Accept equivalent correct solutions (different variable names, style, or valid alternate approaches).
- Reject incomplete stubs, placeholders, syntax that cannot work, or solutions that miss required behavior.
- Ignore whether they included demo console.log / module.exports unless the prompt requires a specific export shape.
- For JavaScript/Node: the logic must satisfy the stated requirements and examples.

Return ONLY valid JSON (no markdown fences):
{
  "correct": true or false,
  "feedback": "2-4 sentences. If wrong, say what fails and a nudge toward fixing it without dumping the full answer. If correct, briefly confirm why."
}`,
      },
    ],
  });

  const parsed = parseJsonFromText(extractText(response));
  return {
    correct: Boolean(parsed.correct),
    feedback: String(parsed.feedback || (parsed.correct ? 'Correct.' : 'Not quite — try again.')).trim(),
  };
}

module.exports = {
  SLOT_PLAN,
  generateDailyQuestions,
  gradeSubmission,
};
