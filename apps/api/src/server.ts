import { app } from './app';
import { startJobs } from './jobs';
import { getPort, jobsEnabled } from './lib/env';

const PORT = getPort();

app.listen({ port: PORT, host: process.env.HOST || '0.0.0.0' }).then(() => {
  console.log(`HTTP Server Running on port ${PORT}`);
  if (jobsEnabled()) startJobs();
});
