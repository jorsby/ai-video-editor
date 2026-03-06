#!/usr/bin/env tsx

const BASE_URL =
  process.argv.find((a) => a.startsWith('--url='))?.split('=')[1] ??
  (process.argv.includes('--url')
    ? process.argv[process.argv.indexOf('--url') + 1]
    : 'http://localhost:3000');

interface RouteTest {
  method: 'GET' | 'POST';
  path: string;
  expected: number;
  label: string;
  body?: string;
}

const routes: RouteTest[] = [
  {
    method: 'GET',
    path: '/api/health',
    expected: 200,
    label: 'all checks passed',
  },
  {
    method: 'POST',
    path: '/api/storyboard/approve',
    expected: 401,
    label: 'auth guard working',
  },
  {
    method: 'POST',
    path: '/api/storyboard/approve-grid',
    expected: 401,
    label: 'auth guard working',
  },
  {
    method: 'POST',
    path: '/api/storyboard/approve-ref-grid',
    expected: 401,
    label: 'auth guard working',
  },
  {
    method: 'POST',
    path: '/api/workflow/video',
    expected: 401,
    label: 'auth guard working',
  },
  {
    method: 'POST',
    path: '/api/workflow/tts',
    expected: 401,
    label: 'auth guard working',
  },
  {
    method: 'POST',
    path: '/api/workflow/sfx',
    expected: 401,
    label: 'auth guard working',
  },
  {
    method: 'POST',
    path: '/api/workflow/edit-image',
    expected: 401,
    label: 'auth guard working',
  },
  {
    method: 'POST',
    path: '/api/workflow/poll-skyreels',
    expected: 200,
    label: 'cron endpoint responding',
  },
  {
    method: 'POST',
    path: '/api/webhook/fal',
    expected: 200,
    label: 'webhook accepting',
    body: '{}',
  },
];

async function testRoute(
  route: RouteTest
): Promise<{ pass: boolean; status: number; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}${route.path}`, {
      method: route.method,
      headers: route.body ? { 'Content-Type': 'application/json' } : undefined,
      body: route.body ?? undefined,
    });
    const pass = res.status === route.expected;
    return { pass, status: res.status };
  } catch (e) {
    return {
      pass: false,
      status: 0,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

async function main() {
  console.log(`\nSmoke testing: ${BASE_URL}\n`);

  const results: {
    route: RouteTest;
    pass: boolean;
    status: number;
    error?: string;
  }[] = [];

  for (const route of routes) {
    const result = await testRoute(route);
    results.push({ route, ...result });

    const icon = result.pass ? '\x1b[32m✅\x1b[0m' : '\x1b[31m❌\x1b[0m';
    const statusText = result.error
      ? `ERROR: ${result.error}`
      : result.pass
        ? `${result.status} (${route.label})`
        : `${result.status} (expected ${route.expected} — BROKEN!)`;
    console.log(
      `${icon} ${route.method.padEnd(4)} ${route.path} — ${statusText}`
    );
  }

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const failed = total - passed;

  console.log(
    `\nResult: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : ''}\n`
  );

  process.exit(failed > 0 ? 1 : 0);
}

main();
