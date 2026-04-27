const ANSI_RE   = /\x1b\[[0-9;]*m/g;
const SKIP_TASK = /^Gathering Facts$|^Build task results|^set_fact|^Validate all tasks$/i;

export const stripAnsi = s => s.replace(ANSI_RE, '');

let _id = 0;
const uid = () => ++_id;

/**
 * Process one log line through the Ansible task parser.
 * Returns { newStep?, updateId?, updateStatus?, removeId?, stepState }
 */
export function parseSolveLine(line, stepState) {
  const clean = stripAnsi(line);
  const tm    = clean.match(/TASK \[([^\]]+)\]/);

  if (tm) {
    const name = tm[1].trim();
    if (SKIP_TASK.test(name)) return { stepState: { currentTask: null, pendingId: null } };
    const id = uid();
    return {
      newStep:   { id, text: name, status: 'pending' },
      stepState: { currentTask: name, pendingId: id },
    };
  }

  const { pendingId } = stepState;

  if (!pendingId) {
    // Skipped-task fatal — still record the failure
    if (/^(fatal|failed):/i.test(clean)) {
      return {
        newStep:   { id: uid(), text: clean.split('=>')[0].trim(), status: 'fail' },
        stepState,
      };
    }
    return { stepState };
  }

  if (/^ok:\s*\[/i.test(clean))            return { updateId: pendingId, updateStatus: 'ok',      stepState };
  if (/^changed:\s*\[/i.test(clean))       return { updateId: pendingId, updateStatus: 'changed',  stepState };
  if (/^(fatal|failed):/i.test(clean))     return { updateId: pendingId, updateStatus: 'fail',     stepState };
  if (/^skipping:\s*\[/i.test(clean))      return { removeId: pendingId,                           stepState };

  return { stepState };
}

/**
 * Parse the validation_check msg field into step objects.
 * Supports both ✅/❌ emoji and [PASS]/[FAIL] bracket formats.
 */
export function parseValidationMsg(line) {
  const clean = stripAnsi(line).trim();
  const m     = clean.match(/"msg":\s*"(.+)"$/);
  if (!m) return [];

  const msg = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
  return msg
    .split('\n')
    .map(p => p.trim())
    .filter(Boolean)
    .map(t => ({
      id:     uid(),
      text:   t,
      status: /^✅/.test(t) || /^\[PASS\]/i.test(t) ? 'ok'
            : /^❌/.test(t) || /^\[FAIL\]/i.test(t) ? 'fail'
            : 'pending',
    }));
}

/** Apply a parser result to the current steps array (immutably). */
export function applyStepResult(steps, result) {
  const { newStep, updateId, updateStatus, removeId } = result;
  if (newStep)   return [...steps, newStep];
  if (removeId)  return steps.filter(s => s.id !== removeId);
  if (updateId)  return steps.map(s => s.id === updateId ? { ...s, status: updateStatus } : s);
  return steps;
}
