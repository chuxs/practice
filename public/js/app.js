(function () {
  const workspace = document.getElementById('workspace');
  if (!workspace || typeof CodeMirror === 'undefined') return;

  const questionId = workspace.dataset.questionId;
  const topic = workspace.dataset.topic || 'javascript';
  const textarea = document.getElementById('code-editor');
  const statusPill = document.getElementById('status-pill');
  const saveHint = document.getElementById('save-hint');
  const btnSave = document.getElementById('btn-save');
  const btnRun = document.getElementById('btn-run');
  const btnTest = document.getElementById('btn-test');
  const btnSolved = document.getElementById('btn-solved');
  const btnPeek = document.getElementById('btn-peek');
  const btnClearOutput = document.getElementById('btn-clear-output');
  const answerPanel = document.getElementById('answer-panel');
  const answerCode = document.getElementById('answer-code');
  const answerExplanation = document.getElementById('answer-explanation');
  const testResult = document.getElementById('test-result');
  const testResultBadge = document.getElementById('test-result-badge');
  const testResultFeedback = document.getElementById('test-result-feedback');
  const outputBox = document.getElementById('output-box');

  const mode = topic === 'sql' ? 'text/x-sql' : 'javascript';

  const editor = CodeMirror.fromTextArea(textarea, {
    lineNumbers: true,
    theme: 'material-darker',
    mode,
    indentUnit: 2,
    tabSize: 2,
    lineWrapping: true,
  });

  function setHint(message) {
    saveHint.hidden = !message;
    saveHint.textContent = message || '';
  }

  function setStatus(status) {
    workspace.dataset.status = status;
    statusPill.textContent = status;
    if (status === 'peeked') {
      btnSolved.disabled = true;
    }
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  }

  async function save(markSolved) {
    setHint(markSolved ? 'Marking solved…' : 'Saving…');
    try {
      const data = await postJson(`/question/${questionId}/save`, {
        code: editor.getValue(),
        markSolved: Boolean(markSolved),
      });
      setStatus(data.status);
      setHint(markSolved ? 'Marked as solved.' : 'Draft saved.');
    } catch (err) {
      setHint(err.message);
    }
  }

  function setOutput(text, ok) {
    outputBox.textContent = text || '';
    outputBox.classList.toggle('has-error', ok === false);
    outputBox.classList.toggle('has-success', ok === true);
  }

  async function runCode() {
    btnRun.disabled = true;
    setHint('Running…');
    setOutput('Running…');
    try {
      const data = await postJson(`/question/${questionId}/run`, {
        code: editor.getValue(),
      });
      setOutput(data.output || '(empty)', data.ok);
      setHint(data.ok ? 'Run finished.' : 'Run finished with an error.');
    } catch (err) {
      setOutput(err.message, false);
      setHint(err.message);
    } finally {
      btnRun.disabled = false;
    }
  }

  function showTestResult(correct, feedback) {
    testResult.hidden = false;
    testResult.classList.toggle('pass', correct);
    testResult.classList.toggle('fail', !correct);
    testResultBadge.textContent = correct ? 'Passed' : 'Failed';
    testResultFeedback.textContent = feedback || '';
    testResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function testCode() {
    btnTest.disabled = true;
    setHint('Testing your code…');
    try {
      const data = await postJson(`/question/${questionId}/test`, {
        code: editor.getValue(),
      });
      setStatus(data.status);
      showTestResult(Boolean(data.correct), data.feedback);
      setHint(
        data.correct
          ? 'Nice — marked as solved.'
          : 'Not quite yet. Adjust your code and test again.'
      );
    } catch (err) {
      setHint(err.message);
      showTestResult(false, err.message);
    } finally {
      btnTest.disabled = false;
    }
  }

  async function peek() {
    const confirmed = window.confirm(
      'Show the answer? This will log this question as “peeked” for today (unless already solved).'
    );
    if (!confirmed) return;

    setHint('Fetching answer…');
    try {
      const data = await postJson(`/question/${questionId}/peek`, {
        code: editor.getValue(),
      });
      setStatus(data.status);
      answerCode.textContent = data.answer || '';
      answerExplanation.textContent = data.explanation || '';
      answerPanel.hidden = false;
      setHint('Answer revealed — logged as peeked if you had not solved it.');
      answerPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      setHint(err.message);
    }
  }

  btnSave.addEventListener('click', () => save(false));
  btnRun.addEventListener('click', runCode);
  btnTest.addEventListener('click', testCode);
  btnSolved.addEventListener('click', () => save(true));
  btnPeek.addEventListener('click', peek);
  btnClearOutput.addEventListener('click', () => {
    setOutput('Click Run to see console output or return values here.');
    outputBox.classList.remove('has-error', 'has-success');
  });

  let saveTimer;
  editor.on('change', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      save(false);
    }, 2500);
  });
})();

(function () {
  const btnWipe = document.getElementById('btn-wipe');
  if (!btnWipe) return;

  const wipeHint = document.getElementById('wipe-hint');

  function setWipeHint(message) {
    if (!wipeHint) return;
    wipeHint.hidden = !message;
    wipeHint.textContent = message || '';
  }

  btnWipe.addEventListener('click', async () => {
    const first = window.confirm(
      'Wipe ALL data?\n\nThis deletes every question and progress record. This cannot be undone.'
    );
    if (!first) return;

    const typed = window.prompt('Type WIPE to confirm permanent deletion:');
    if (typed !== 'WIPE') {
      setWipeHint('Cancelled — you must type WIPE exactly.');
      return;
    }

    btnWipe.disabled = true;
    setWipeHint('Deleting…');

    try {
      const res = await fetch('/admin/wipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ confirm: 'WIPE' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Wipe failed');
      }
      setWipeHint(
        `Deleted ${data.deleted.questions} questions and ${data.deleted.progress} progress days.`
      );
      window.setTimeout(() => {
        window.location.href = '/';
      }, 900);
    } catch (err) {
      setWipeHint(err.message);
      btnWipe.disabled = false;
    }
  });
})();
