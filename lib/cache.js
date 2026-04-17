const CACHE_TTL_SECONDS = 3600;

export function generateJobId() {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
}

export async function saveResults(jobId, results, KV) {
  if (!KV) throw new Error('KV namespace not bound');
  await KV.put(
    `analysis:${jobId}`,
    JSON.stringify({ jobId, results, cachedAt: Date.now() }),
    { expirationTtl: CACHE_TTL_SECONDS }
  );
  return { success: true, jobId };
}

export async function getResults(jobId, KV) {
  if (!KV) throw new Error('KV namespace not bound');
  const cached = await KV.get(`analysis:${jobId}`, { type: 'text' });
  if (!cached) return null;
  const data = JSON.parse(cached);
  if (Date.now() - data.cachedAt > CACHE_TTL_SECONDS * 1000) {
    await KV.delete(`analysis:${jobId}`);
    return null;
  }
  return data.results;
}
