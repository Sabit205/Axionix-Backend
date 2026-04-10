require('dotenv').config();
const http = require('http');
const { Worker } = require('bullmq');
const Redis = require('ioredis');
const { processCrawlJob } = require('./crawler');

// Render Free Tier HTTP Binding (Required to keep 'web' service alive)
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('AxionixSearch Worker is alive!\n');
}).listen(PORT, () => console.log(`Health check server listening on port ${PORT}`));

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Initialize Redis connection
const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

console.log('Worker initializing, connecting to Redis:', REDIS_URL.split('@').pop() || REDIS_URL); // Don't log credentials

// Initialize BullMQ Worker
const worker = new Worker(
  'crawl-queue',
  async (job) => {
    console.log(`[Job ${job.id}] Started processing domain: ${job.data.domain}`);
    try {
      await processCrawlJob(job.data.domain, job.data.url);
      console.log(`[Job ${job.id}] Completed processing domain: ${job.data.domain}`);
    } catch (err) {
      console.error(`[Job ${job.id}] Failed processing domain: ${job.data.domain}`, err);
      throw err;
    }
  },
  {
    connection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY) || 2, // Respect CPU limits, 1-2 concurrent domains
  }
);

worker.on('ready', () => {
  console.log('Worker ready and listening for jobs on "crawl-queue"');
});

worker.on('failed', (job, err) => {
  console.log(`Job ${job.id} failed with error: ${err.message}`);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing worker...');
  await worker.close();
  await connection.quit();
  process.exit(0);
});
