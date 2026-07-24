const express = require('express');
const Question = require('../models/Question');
const Progress = require('../models/Progress');
const {
  todayKey,
  ensureDailySet,
  summarizeDay,
  getHistory,
} = require('../services/daily');
const { gradeSubmission } = require('../services/claude');
const { runCode } = require('../services/runner');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const dateKey = todayKey();
    const { questions, progress } = await ensureDailySet(dateKey);
    const summary = summarizeDay(questions, progress);
    const history = await getHistory(14);

    res.render('home', {
      title: 'Daily Practice',
      dateKey,
      questions: summary.items,
      stats: summary.stats,
      history,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/progress', async (req, res, next) => {
  try {
    const history = await getHistory(30);
    res.render('progress', {
      title: 'Progress',
      history,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/question/:id', async (req, res, next) => {
  try {
    const question = await Question.findById(req.params.id).lean();
    if (!question) {
      const err = new Error('Question not found');
      err.status = 404;
      throw err;
    }

    const progress = await Progress.findOne({ dateKey: question.dateKey });
    if (!progress) {
      const err = new Error('Progress not found for this question');
      err.status = 404;
      throw err;
    }

    const attempt = progress.attempts.find(
      (a) => String(a.question) === String(question._id)
    );

    res.render('question', {
      title: question.title,
      question,
      attempt: attempt || {
        status: 'unsolved',
        code: question.starterCode || '',
      },
      showAnswer: false,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/question/:id/save', async (req, res, next) => {
  try {
    const question = await Question.findById(req.params.id);
    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    const { code, markSolved } = req.body;
    let progress = await Progress.findOne({ dateKey: question.dateKey });
    if (!progress) {
      progress = await Progress.create({
        dateKey: question.dateKey,
        attempts: [
          {
            question: question._id,
            status: 'unsolved',
            code: question.starterCode || '',
          },
        ],
      });
    }

    let attempt = progress.attempts.find(
      (a) => String(a.question) === String(question._id)
    );
    if (!attempt) {
      progress.attempts.push({
        question: question._id,
        status: 'unsolved',
        code: question.starterCode || '',
      });
      attempt = progress.attempts[progress.attempts.length - 1];
    }

    if (typeof code === 'string') {
      attempt.code = code;
    }

    if (markSolved && attempt.status !== 'peeked') {
      attempt.status = 'solved';
      attempt.solvedAt = new Date();
    }

    await progress.save();
    res.json({
      ok: true,
      status: attempt.status,
      code: attempt.code,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/question/:id/run', async (req, res, next) => {
  try {
    const question = await Question.findById(req.params.id).lean();
    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    const code = typeof req.body.code === 'string' ? req.body.code : '';
    const result = await runCode(question.topic, code);

    // Persist draft so a run doesn't lose work
    let progress = await Progress.findOne({ dateKey: question.dateKey });
    if (progress) {
      const attempt = progress.attempts.find(
        (a) => String(a.question) === String(question._id)
      );
      if (attempt && typeof code === 'string') {
        attempt.code = code;
        await progress.save();
      }
    }

    res.json({
      ok: result.ok,
      output: result.output,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/question/:id/test', async (req, res, next) => {
  try {
    const question = await Question.findById(req.params.id);
    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    const code = typeof req.body.code === 'string' ? req.body.code : '';
    const result = await gradeSubmission(question, code);

    let progress = await Progress.findOne({ dateKey: question.dateKey });
    if (!progress) {
      progress = await Progress.create({
        dateKey: question.dateKey,
        attempts: [],
      });
    }

    let attempt = progress.attempts.find(
      (a) => String(a.question) === String(question._id)
    );
    if (!attempt) {
      progress.attempts.push({
        question: question._id,
        status: 'unsolved',
        code: question.starterCode || '',
      });
      attempt = progress.attempts[progress.attempts.length - 1];
    }

    attempt.code = code;

    if (result.correct && attempt.status !== 'peeked') {
      attempt.status = 'solved';
      attempt.solvedAt = attempt.solvedAt || new Date();
    }

    await progress.save();

    res.json({
      ok: true,
      correct: result.correct,
      feedback: result.feedback,
      status: attempt.status,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/question/:id/peek', async (req, res, next) => {
  try {
    const question = await Question.findById(req.params.id).lean();
    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    const { code } = req.body;
    let progress = await Progress.findOne({ dateKey: question.dateKey });
    if (!progress) {
      progress = await Progress.create({
        dateKey: question.dateKey,
        attempts: [],
      });
    }

    let attempt = progress.attempts.find(
      (a) => String(a.question) === String(question._id)
    );
    if (!attempt) {
      progress.attempts.push({
        question: question._id,
        status: 'unsolved',
        code: question.starterCode || '',
      });
      attempt = progress.attempts[progress.attempts.length - 1];
    }

    if (typeof code === 'string') {
      attempt.code = code;
    }

    // Peeking before a solve is logged as peeked; already-solved stays solved.
    if (attempt.status !== 'solved') {
      attempt.status = 'peeked';
      attempt.peekedAt = attempt.peekedAt || new Date();
    }

    await progress.save();

    res.json({
      ok: true,
      status: attempt.status,
      answer: question.answer,
      explanation: question.explanation,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/day/:dateKey', async (req, res, next) => {
  try {
    const { dateKey } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      const err = new Error('Invalid date');
      err.status = 400;
      throw err;
    }

    const questions = await Question.find({ dateKey }).sort({ order: 1 }).lean();
    if (questions.length === 0) {
      return res.status(404).render('error', {
        title: 'Not found',
        message: `No practice set for ${dateKey}`,
        status: 404,
      });
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
    }

    const summary = summarizeDay(questions, progress);
    const history = await getHistory(14);

    res.render('home', {
      title: `Practice · ${dateKey}`,
      dateKey,
      questions: summary.items,
      stats: summary.stats,
      history,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/wipe', async (req, res, next) => {
  try {
    if (req.body.confirm !== 'WIPE') {
      return res.status(400).json({
        error: 'Confirmation failed. Send confirm: "WIPE" to delete all data.',
      });
    }

    const [questions, progress] = await Promise.all([
      Question.deleteMany({}),
      Progress.deleteMany({}),
    ]);

    res.json({
      ok: true,
      deleted: {
        questions: questions.deletedCount,
        progress: progress.deletedCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
