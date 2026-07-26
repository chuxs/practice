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
];

const SUBMIT_QUESTIONS_TOOL = {
  name: 'submit_daily_questions',
  description: 'Submit exactly 4 daily practice coding questions as structured data.',
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: 'Exactly 4 questions in slot order',
        items: {
          type: 'object',
          properties: {
            difficulty: { type: 'string', enum: ['easy', 'medium'] },
            topic: { type: 'string', enum: ['javascript', 'nodejs'] },
            title: { type: 'string' },
            prompt: { type: 'string' },
            starterCode: { type: 'string' },
            answer: { type: 'string' },
            explanation: { type: 'string' },
          },
          required: [
            'difficulty',
            'topic',
            'title',
            'prompt',
            'starterCode',
            'answer',
            'explanation',
          ],
        },
      },
    },
    required: ['questions'],
  },
};

const GRADE_TOOL = {
  name: 'grade_submission',
  description: 'Grade whether a learner submission correctly solves the problem.',
  input_schema: {
    type: 'object',
    properties: {
      correct: { type: 'boolean' },
      feedback: { type: 'string' },
    },
    required: ['correct', 'feedback'],
  },
};

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

Call the submit_daily_questions tool with exactly 4 questions in this slot order:
1. easy / javascript
2. easy / nodejs
3. medium / javascript
4. medium / nodejs

Make every prompt HIGHLY descriptive. Each prompt MUST include all of these sections (plain text, use newlines):
1) Goal — one clear sentence of what to build
2) Requirements — numbered list of exact behaviors / edge cases
3) Constraints — what they may/may not use (e.g. no external packages)
4) Examples — at least 2 worked examples with input AND expected output
5) How to verify — what to console.log / call so Run shows useful output

Topic guidance:
- JavaScript: language fundamentals (arrays, objects, closures, prototypes, this, async/await, promises, ES6+). CommonJS module.exports is allowed.
- Node.js: core modules/runtime (path, url, events, streams, Buffer, process, timers, HTTP basics without Express). Prefer console.log demos. Do NOT require filesystem writes, long-lived servers, or non-core packages.

Rules:
- Answerable in one editor (function or short script).
- Vary concepts across the 4 questions.
- starterCode: incomplete scaffold PLUS demo console.log calls at the bottom. Include module.exports when relevant.
- answer: complete correct solution including the same demo calls.
- explanation: 3–6 sentences teaching the key idea.
- Titles should be specific.
- Keep each code sample reasonably concise so the full payload fits cleanly.`;
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
    if (q.prompt.length < 120) {
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

function extractToolInput(response, toolName) {
  const block = response.content.find(
    (item) => item.type === 'tool_use' && item.name === toolName
  );
  if (!block || !block.input || typeof block.input !== 'object') {
    return null;
  }
  return block.input;
}

function parseJsonFromText(text) {
  if (!text || !String(text).trim()) {
    throw new Error('Failed to parse Claude JSON response (empty)');
  }

  let candidate = String(text).trim();
  const fenceMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    candidate = fenceMatch[1].trim();
  }

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    candidate = candidate.slice(start, end + 1);
  }

  try {
    return JSON.parse(candidate);
  } catch (err) {
    const snippet = candidate.slice(0, 180).replace(/\s+/g, ' ');
    throw new Error(`Failed to parse Claude JSON response: ${err.message}. Snippet: ${snippet}`);
  }
}

function extractStructuredPayload(response, toolName) {
  const toolInput = extractToolInput(response, toolName);
  if (toolInput) return toolInput;

  // Fallback if the model returned plain JSON text instead of tool_use
  return parseJsonFromText(extractText(response));
}

async function generateDailyQuestions(dateKey) {
  const client = getClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    tools: [SUBMIT_QUESTIONS_TOOL],
    tool_choice: { type: 'tool', name: SUBMIT_QUESTIONS_TOOL.name },
    messages: [{ role: 'user', content: buildPrompt(dateKey) }],
  });

  const stopReason = response.stop_reason;
  if (stopReason === 'max_tokens') {
    throw new Error(
      'Claude response was truncated while generating questions. Try again in a moment.'
    );
  }

  const parsed = extractStructuredPayload(response, SUBMIT_QUESTIONS_TOOL.name);
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
    max_tokens: 800,
    tools: [GRADE_TOOL],
    tool_choice: { type: 'tool', name: GRADE_TOOL.name },
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

Call grade_submission with your verdict.`,
      },
    ],
  });

  const parsed = extractStructuredPayload(response, GRADE_TOOL.name);
  return {
    correct: Boolean(parsed.correct),
    feedback: String(
      parsed.feedback || (parsed.correct ? 'Correct.' : 'Not quite — try again.')
    ).trim(),
  };
}

module.exports = {
  SLOT_PLAN,
  generateDailyQuestions,
  gradeSubmission,
};
