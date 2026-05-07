export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
    return;
  }

  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  await import('./sentry.server.config');

  const { installServerConsoleErrorReporter } = await import('./src/lib/server/opsConsoleInstrumentation');
  installServerConsoleErrorReporter();
}
