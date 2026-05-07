import { NextResponse } from 'next/server';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

export const runtime = 'nodejs';

const DEFAULT_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 5_000;
const MIN_TIMEOUT_MS = 100;
const MAX_CODE_LENGTH = 20_000;

type ExecuteRequest = {
  code?: unknown;
  timeoutMs?: unknown;
};

type WorkerResponse = {
  ok: boolean;
  result?: { type: string; value: string };
  logs?: Array<{ level: string; message: string }>;
  timeline?: Array<{
    step: number;
    line: number;
    event: string;
    variables: Record<string, { type: string; value: string }>;
  }>;
  instrumentation?: { hookCount: number };
  error?: string;
};

function normalizeTimeout(timeoutMs: unknown) {
  if (typeof timeoutMs !== 'number' || Number.isNaN(timeoutMs)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.trunc(timeoutMs)));
}

function runInSandbox(code: string, timeoutMs: number) {
  const workerPath = path.join(process.cwd(), 'lib/sandbox/executeWorker.mjs');
  const startedAt = performance.now();

  return new Promise<WorkerResponse & { durationMs: number; timedOut: boolean }>((resolve) => {
    const worker = new Worker(workerPath, {
      workerData: { code, timeoutMs },
      resourceLimits: {
        maxOldGenerationSizeMb: 32,
        maxYoungGenerationSizeMb: 8,
        stackSizeMb: 1,
      },
    });

    let settled = false;
    const killTimer = setTimeout(() => {
      finish({ ok: false, error: `Execution timed out after ${timeoutMs}ms.` }, true);
    }, timeoutMs + 100);

    function finish(response: WorkerResponse, timedOut = false) {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      worker.terminate().catch(() => undefined);
      resolve({
        ...response,
        logs: response.logs ?? [],
        timeline: response.timeline ?? [],
        durationMs: Math.round(performance.now() - startedAt),
        timedOut,
      });
    }

    worker.once('message', (message: WorkerResponse) => finish(message));
    worker.once('error', (error) => finish({ ok: false, error: error.message }));
    worker.once('exit', (code) => {
      if (code !== 0) finish({ ok: false, error: `Sandbox worker exited with code ${code}.` });
    });
  });
}

export async function POST(request: Request) {
  let body: ExecuteRequest;

  try {
    body = (await request.json()) as ExecuteRequest;
  } catch {
    return NextResponse.json({ ok: false, error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  if (typeof body.code !== 'string') {
    return NextResponse.json({ ok: false, error: '`code` must be a string.' }, { status: 400 });
  }

  if (body.code.length > MAX_CODE_LENGTH) {
    return NextResponse.json(
      { ok: false, error: `Code exceeds the ${MAX_CODE_LENGTH} character limit.` },
      { status: 413 }
    );
  }

  const timeoutMs = normalizeTimeout(body.timeoutMs);
  const response = await runInSandbox(body.code, timeoutMs);
  return NextResponse.json(response, { status: response.ok ? 200 : 422 });
}
