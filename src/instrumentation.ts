export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runStartupTasks } = await import('./server/startup');
    await runStartupTasks();
  }
}
