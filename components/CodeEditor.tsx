'use client';

import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { useMemo, useRef, useState } from 'react';

const starterCode = `function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

const value = 6;
const result = fibonacci(value);
console.log({ value, result });
result;`;

type ExecutionLog = {
  level: string;
  message: string;
};

type SerializedValue = {
  type: string;
  value: string;
};

type TimelineEvent = {
  step: number;
  line: number;
  event: string;
  variables: Record<string, SerializedValue>;
};

type ExecutionResponse = {
  ok: boolean;
  result?: SerializedValue;
  logs: ExecutionLog[];
  timeline: TimelineEvent[];
  instrumentation?: { hookCount: number };
  error?: string;
  durationMs: number;
  timedOut: boolean;
};

export default function CodeEditor() {
  const [code, setCode] = useState(starterCode);
  const [output, setOutput] = useState<ExecutionResponse | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<string[]>([]);

  const options = useMemo(
    () => ({
      automaticLayout: true,
      fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 14,
      lineHeight: 22,
      minimap: { enabled: false },
      glyphMargin: true,
      lineNumbers: 'on' as const,
      smoothScrolling: true,
      scrollBeyondLastLine: false,
      tabSize: 2,
      padding: { top: 16, bottom: 16 },
    }),
    []
  );

  const handleEditorWillMount = (monaco: Monaco) => {
    monaco.editor.defineTheme('void', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: '', foreground: 'D7E4F8' },
        { token: 'keyword', foreground: '88B4FF' },
        { token: 'number', foreground: 'F4CA64' },
        { token: 'string', foreground: '95D8A6' },
        { token: 'comment', foreground: '6A7D9B' },
      ],
      colors: {
        'editor.background': '#0B1020',
        'editorLineNumber.foreground': '#425176',
        'editorLineNumber.activeForeground': '#8FB5FF',
        'editorCursor.foreground': '#7AB8FF',
        'editor.selectionBackground': '#1B325C99',
        'editor.lineHighlightBackground': '#111A2D',
      },
    });
  };

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  };

  const highlightLine = (line: number) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, [
      {
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: 'executionLine',
          glyphMarginClassName: 'executionGlyph',
        },
      },
    ]);
    editor.revealLineInCenter(line);
  };

  const selectStep = (event: TimelineEvent) => {
    setSelectedStep(event.step);
    highlightLine(event.line);
  };

  const runCode = async () => {
    setIsRunning(true);
    setOutput(null);
    setSelectedStep(null);

    if (editorRef.current) {
      decorationsRef.current = editorRef.current.deltaDecorations(decorationsRef.current, []);
    }

    try {
      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, timeoutMs: 1000 }),
      });
      const result = (await response.json()) as ExecutionResponse;
      setOutput(result);
      if (result.timeline?.[0]) {
        setSelectedStep(result.timeline[0].step);
        highlightLine(result.timeline[0].line);
      }
    } catch (error) {
      setOutput({
        ok: false,
        logs: [],
        timeline: [],
        durationMs: 0,
        timedOut: false,
        error: error instanceof Error ? error.message : 'Unable to reach the execution sandbox.',
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="codeRunner">
      <div className="runnerToolbar">
        <button className="primaryAction" type="button" onClick={runCode} disabled={isRunning}>
          {isRunning ? 'Tracing…' : 'Trace Execution'}
        </button>
        <span>AST hooks · JavaScript VM · 1s timeout · isolated worker</span>
      </div>

      <div className="monacoPane">
        <Editor
          height="100%"
          defaultLanguage="javascript"
          value={code}
          onChange={(value) => setCode(value ?? '')}
          beforeMount={handleEditorWillMount}
          onMount={handleEditorMount}
          theme="void"
          options={options}
        />
      </div>

      <div className={`outputPane ${output?.ok ? 'success' : output ? 'failure' : ''}`}>
        <div className="outputHeader">
          <span>Execution Timeline</span>
          {output ? (
            <span>
              {output.timeline.length} events · {output.instrumentation?.hookCount ?? 0} hooks · {output.durationMs}ms
            </span>
          ) : (
            <span>Idle</span>
          )}
        </div>
        {output ? (
          <div className="outputBody">
            {output.error ? <pre className="errorText">{output.error}</pre> : null}
            {output.result ? <pre>Result ({output.result.type}): {output.result.value}</pre> : null}
            {output.timeline.length ? (
              <ol className="timelineList" aria-label="Execution trace events">
                {output.timeline.map((event) => (
                  <li key={event.step}>
                    <button
                      className={selectedStep === event.step ? 'timelineStep active' : 'timelineStep'}
                      type="button"
                      onClick={() => selectStep(event)}
                    >
                      <span className="stepMeta">#{event.step} · line {event.line} · {event.event}</span>
                      {Object.keys(event.variables).length ? (
                        <span className="variableList">
                          {Object.entries(event.variables).map(([name, value]) => (
                            <code key={`${event.step}-${name}`}>
                              {name}: {value.value}
                            </code>
                          ))}
                        </span>
                      ) : (
                        <span className="variableList muted">loop checkpoint</span>
                      )}
                    </button>
                  </li>
                ))}
              </ol>
            ) : null}
            {output.logs.length ? (
              <div className="logList">
                {output.logs.map((log, index) => (
                  <pre key={`${log.level}-${index}`}>[{log.level}] {log.message}</pre>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p>Run code to see variable snapshots, loop checkpoints, console output, errors, and timeout status.</p>
        )}
      </div>
    </div>
  );
}
