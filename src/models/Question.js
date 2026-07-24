const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema(
  {
    dateKey: { type: String, required: true, index: true },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      required: true,
    },
    topic: {
      type: String,
      enum: ['javascript', 'nodejs', 'sql'],
      required: true,
    },
    title: { type: String, required: true },
    prompt: { type: String, required: true },
    starterCode: { type: String, default: '' },
    answer: { type: String, required: true },
    explanation: { type: String, required: true },
    order: { type: Number, required: true },
  },
  { timestamps: true }
);

questionSchema.index({ dateKey: 1, order: 1 }, { unique: true });

module.exports = mongoose.model('Question', questionSchema);
