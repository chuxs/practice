const Question = require('../models/Question');
const Progress = require('../models/Progress');
const { generateDailyQuestions } = require('../services/claude');

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

async function ensureDailySet(dateKey = todayKey()) {
  let questions = await Question.find({ dateKey }).sort({ order: 1 }).lean();

  if (questions.length === 0) {
    const generated = await generateDailyQuestions(dateKey);
    try {
      await Question.insertMany(
        generated.map((q) => ({
          ...q,
          dateKey,
        })),
        { ordered: false }
      );
    } catch (err) {
      // Ignore duplicate key errors, they mean the questions already exist
      if (!err.message.includes('E11000')) throw err;
    }
    questions = await Question.find({ dateKey }).sort({ order: 1 }).lean();
  }

  let progress = await Progress.findOne({ dateKey });
  if (!progress) {
    progress = await Progress.create({
      dateKey,
      attempts: questions.map((q) => ({
        question: q._id,
        status: 'unsolved',
        code: q.starterCode || '',
      })),
    });
  } else if (progress.attempts.length === 0 && questions.length > 0) {
    progress.attempts = questions.map((q) => ({
      question: q._id,
      status: 'unsolved',
      code: q.starterCode || '',
    }));
    await progress.save();
  }

  return { questions, progress };
}

function attemptMap(progress) {
  const map = new Map();
  for (const attempt of progress.attempts) {
    map.set(String(attempt.question), attempt);
  }
  return map;
}

function summarizeDay(questions, progress) {
  const map = attemptMap(progress);
  let solved = 0;
  let peeked = 0;
  let unsolved = 0;

  const items = questions.map((q) => {
    const attempt = map.get(String(q._id));
    const status = attempt?.status || 'unsolved';
    if (status === 'solved') solved += 1;
    else if (status === 'peeked') peeked += 1;
    else unsolved += 1;

    return {
      ...q,
      status,
      code: attempt?.code ?? q.starterCode ?? '',
    };
  });

  return {
    items,
    stats: {
      total: questions.length,
      solved,
      peeked,
      unsolved,
    },
  };
}

async function getHistory(limit = 14) {
  const progressDocs = await Progress.find({})
    .sort({ dateKey: -1 })
    .limit(limit)
    .lean();

  const history = [];
  for (const doc of progressDocs) {
    const questions = await Question.find({ dateKey: doc.dateKey }).lean();
    const summary = summarizeDay(questions, doc);
    history.push({
      dateKey: doc.dateKey,
      ...summary.stats,
    });
  }
  return history;
}

module.exports = {
  todayKey,
  ensureDailySet,
  attemptMap,
  summarizeDay,
  getHistory,
};
