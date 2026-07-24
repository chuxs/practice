const mongoose = require('mongoose');

const attemptSchema = new mongoose.Schema(
  {
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question',
      required: true,
    },
    status: {
      type: String,
      enum: ['unsolved', 'solved', 'peeked'],
      default: 'unsolved',
    },
    code: { type: String, default: '' },
    peekedAt: { type: Date },
    solvedAt: { type: Date },
  },
  { _id: false }
);

const progressSchema = new mongoose.Schema(
  {
    dateKey: { type: String, required: true, unique: true },
    attempts: [attemptSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Progress', progressSchema);
