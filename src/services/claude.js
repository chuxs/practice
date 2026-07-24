const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

/**
 * Daily set: 2 easy, 2 medium, 2 hard.
 * Topics rotate across javascript, nodejs, and sql.
 */
const SLOT_PLAN = [
  { difficulty: 'easy', topic: 'javascript' },
  { difficulty: 'easy', topic: 'sql' },
  { difficulty: 'medium', topic: 'nodejs' },
  { difficulty: 'medium', topic: 'javascript' },
  { difficulty: 'hard', topic: 'nodejs' },
  { difficulty: 'hard', topic: 'sql' },
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
  return `You are a senior coding instructor. Generate exactly 6 practice coding questions for date ${dateKey}.

Requirements for each slot (in order):
1. easy / javascript
2. easy / sql
3. medium / nodejs
4. medium / javascript
5. hard / nodejs
6. hard / sql

Rules:
- Questions must be answerable in a single code editor (write a function, query, or short script).
- Vary concepts; do not repeat the same pattern.
- For SQL: use standard SQL (PostgreSQL-flavored is fine). Provide table schemas in the prompt when needed.
- For Node.js: focus on core APIs, async patterns, streams, modules, HTTP — not frameworks unless essential.
- For JavaScript: focus on language fundamentals, arrays, objects, closures, async, ES6+.
- starterCode should be a short scaffold the learner fills in (not empty, not the full answer).
- answer must be a complete, correct solution.
- explanation should teach why the solution works (2–5 sentences).

Return ONLY valid JSON (no markdown fences) with this shape:
{
  "questions": [
    {
      "difficulty": "easy|medium|hard",
      "topic": "javascript|nodejs|sql",
      "title": "short title",
      "prompt": "full problem statement with examples if useful",
      "starterCode": "starter code",
      "answer": "full solution code",
      "explanation": "teaching explanation"
    }
  ]
}`;
}

function normalizeGenerated(parsed) {
  if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length !== 6) {
    throw new Error('Claude returned an unexpected question payload');
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
    max_tokens: 8000,
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
- For SQL: accept equivalent queries that produce the same result (column aliases may differ if the prompt allows).
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
