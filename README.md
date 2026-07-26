# Drill

Daily coding practice for **JavaScript**, **Node.js**, and **SQL**.

Each day you get **4 questions** (easy + medium for JavaScript and Node.js). Write solutions in a code editor, mark what you solved, or tap **Show answer** when you need to peek — your progress is logged per day.

Questions and detailed answers are generated with the **Anthropic Claude** API. Data lives in **MongoDB**. The UI is **Express + EJS + vanilla JS/CSS**.

## Stack

- Node.js / Express
- EJS templates
- MongoDB (Mongoose)
- Anthropic SDK (`@anthropic-ai/sdk`)
- CodeMirror editor

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy env and add your keys:

```bash
cp .env.example .env
```

Set:

- `ANTHROPIC_API_KEY` — required for generating the daily set
- `MONGODB_URI` — defaults to `mongodb://127.0.0.1:27017/js-node-practice`

3. Start MongoDB locally (or point `MONGODB_URI` at Atlas).

4. Run the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The first visit each day calls Claude to create that day’s questions, then stores them in MongoDB so later visits reuse the same set.

## How it works

| Action | Effect |
|--------|--------|
| **Save** | Stores your current editor draft |
| **Mark solved** | Logs the question as solved (disabled after peek) |
| **Show answer** | Reveals Claude’s solution + explanation and logs **peeked** |

Progress pages show solved / peeked / open counts per day.

## Daily question mix

| Order | Difficulty | Topic |
|-------|------------|--------|
| 1 | easy | javascript |
| 2 | easy | nodejs |
| 3 | medium | javascript |
| 4 | medium | nodejs |

SQL is paused for now.

## Project layout

```
src/
  config/db.js
  models/Question.js
  models/Progress.js
  routes/practice.js
  services/claude.js
  services/daily.js
  server.js
views/
public/css
public/js
```

## Notes

- No auth yet — designed as a personal practice tool on your machine.
- Answers are not embedded in the question page HTML; they load only after **Show answer**.
- Auto-save runs ~2.5s after you stop typing in the editor.
