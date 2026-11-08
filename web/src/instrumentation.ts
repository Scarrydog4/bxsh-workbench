export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startRewriteWorker } = await import('./server/toolbox')
    startRewriteWorker()
    const { startJobs } = await import('./server/jobs')
    startJobs()
  }
}
