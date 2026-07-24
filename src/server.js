const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const express = require('express');
const morgan = require('morgan');
const connectDB = require('./config/db');
const practiceRoutes = require('./routes/practice');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

app.use('/', practiceRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  if (req.accepts('html')) {
    return res.status(status).render('error', {
      title: 'Error',
      message: err.message || 'Something went wrong',
      status,
    });
  }
  res.status(status).json({ error: err.message || 'Something went wrong' });
});

async function start() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Practice platform running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
