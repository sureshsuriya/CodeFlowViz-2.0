import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { instrumentCode } from './instrument.mjs';

test('instrumentCode - IfStatement regression tests', async (t) => {
  await t.test('wraps blockless if-else consequent and alternate in braces and traces correctly', () => {
    const code = `
let x = 0;
if (x === 0)
  x = 1;
else
  x = 2;
`;
    const { code: instrumented, hookCount } = instrumentCode(code);
    
    // Check that we have hooks
    assert.ok(hookCount > 0, 'Should have hooks instrumented');

    // Check that the code is wrapped in braces correctly
    assert.match(instrumented, /if\s*\(x === 0\)\s*\{\s*x = 1;/, 'Consequent should be wrapped in braces');
    assert.match(instrumented, /else\s*\{\s*x = 2;/, 'Alternate should be wrapped in braces');

    // Verify the instrumented code is syntactically valid and compiles
    assert.doesNotThrow(() => {
      new vm.Script(instrumented);
    }, 'Instrumented code should compile without SyntaxError');
  });

  await t.test('handles if-else with BlockStatement bodies normally', () => {
    const code = `
let x = 0;
if (x === 0) {
  x = 1;
} else {
  x = 2;
}
`;
    const { code: instrumented } = instrumentCode(code);

    assert.match(instrumented, /if\s*\(x === 0\)\s*\{\s*x = 1;/, 'Consequent should remain wrapped in braces');
    assert.match(instrumented, /else\s*\{\s*x = 2;/, 'Alternate should remain wrapped in braces');

    assert.doesNotThrow(() => {
      new vm.Script(instrumented);
    }, 'Instrumented code should compile without SyntaxError');
  });

  await t.test('handles loops without BlockStatement bodies by wrapping them in braces', () => {
    const code = `
let x = 0;
while (x < 5)
  x++;
`;
    const { code: instrumented } = instrumentCode(code);

    assert.match(instrumented, /while\s*\(x < 5\)\s*\{/, 'While loop body should be wrapped in braces');
    assert.doesNotThrow(() => {
      new vm.Script(instrumented);
    }, 'Instrumented loop should compile without SyntaxError');
  });
});

test('instrumentCode - ReturnStatement tracing tests', async (t) => {
  const runSandbox = (setupCode, expectedReturn, expectedFinalVars, expectedCapturedVars) => {
    const { code: instrumented } = instrumentCode(setupCode);

    // Check that it compiles
    assert.doesNotThrow(() => {
      new vm.Script(instrumented);
    }, 'Instrumented code should compile without syntax errors');

    const events = [];
    const sandbox = {
      __trace: {
        capture(line, event, variables) {
          events.push({ line, event, variables });
        }
      }
    };

    const context = vm.createContext(sandbox);
    const script = new vm.Script(instrumented);
    const returnVal = script.runInContext(context);

    // Verify return value
    assert.strictEqual(returnVal, expectedReturn, 'Return value should be preserved exactly');

    // Verify final variable values in sandbox
    for (const [name, val] of Object.entries(expectedFinalVars)) {
      assert.strictEqual(sandbox[name], val, `Variable ${name} should have correct final value`);
    }

    // Verify captured variables in trace events
    const assignmentEvents = events.filter(e => e.event === 'assignment' && e.line > 1);
    assert.ok(assignmentEvents.length > 0, 'Should capture at least one assignment trace event');

    const lastEvent = assignmentEvents[assignmentEvents.length - 1];
    for (const [name, val] of Object.entries(expectedCapturedVars)) {
      assert.ok(name in lastEvent.variables, `Captured event should contain variable ${name}`);
      assert.strictEqual(lastEvent.variables[name], val, `Captured variable ${name} should match expected state`);
    }
  };

  await t.test('simple assignment inside return statement', () => {
    const code = `
var x = 0;
function run() {
  return x = 5;
}
run();
`;
    runSandbox(code, 5, { x: 5 }, { x: 5 });
  });

  await t.test('compound assignment inside return statement', () => {
    const code = `
var x = 2;
function run() {
  return x += 3;
}
run();
`;
    runSandbox(code, 5, { x: 5 }, { x: 5 });
  });

  await t.test('prefix increment inside return statement', () => {
    const code = `
var count = 0;
function run() {
  return ++count;
}
run();
`;
    runSandbox(code, 1, { count: 1 }, { count: 1 });
  });

  await t.test('postfix increment inside return statement', () => {
    const code = `
var count = 0;
function run() {
  return count++;
}
run();
`;
    // Postfix returns old value (0) but updates variable to 1
    runSandbox(code, 0, { count: 1 }, { count: 1 });
  });

  await t.test('prefix decrement inside return statement', () => {
    const code = `
var count = 5;
function run() {
  return --count;
}
run();
`;
    runSandbox(code, 4, { count: 4 }, { count: 4 });
  });

  await t.test('postfix decrement inside return statement', () => {
    const code = `
var count = 5;
function run() {
  return count--;
}
run();
`;
    // Postfix returns old value (5) but updates variable to 4
    runSandbox(code, 5, { count: 4 }, { count: 4 });
  });

  await t.test('multiple assignments inside single return statement', () => {
    const code = `
var x = 0;
var y = 0;
function run() {
  return (x = 5) + (y = 10);
}
run();
`;
    runSandbox(code, 15, { x: 5, y: 10 }, { x: 5, y: 10 });
  });

  await t.test('expression is evaluated exactly once', () => {
    const code = `
var calls = 0;
var x = 0;
function getValue() {
  calls++;
  return 10;
}
function run() {
  return x = getValue();
}
run();
`;
    const { code: instrumented } = instrumentCode(code);
    const sandbox = {
      __trace: { capture() {} }
    };
    const context = vm.createContext(sandbox);
    new vm.Script(instrumented).runInContext(context);

    assert.strictEqual(sandbox.calls, 1, 'RHS of assignment inside return should only be evaluated once');
  });

  await t.test('existing normal assignment tracing still works', () => {
    const code = `
var x = 0;
x = 100;
`;

    const { code: instrumented } = instrumentCode(code);
    const events = [];
    const sandbox = {
      __trace: {
        capture(line, event, variables) {
          events.push({ line, event, variables });
        }
      }
    };
    const context = vm.createContext(sandbox);
    new vm.Script(instrumented).runInContext(context);

    const normalAssignments = events.filter(e => e.variables.x === 100);
    assert.strictEqual(normalAssignments.length, 1, 'Existing normal assignments outside return should still be traced');
  });
});
