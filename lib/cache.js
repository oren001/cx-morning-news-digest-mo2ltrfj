```javascript
const CACHE_TTL_SECONDS = 3600;

export function generateJobId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `job_${timestamp}_${random}`;
}

export async function saveResults(jobId, results, KV) {
  if (!KV) {
    throw new Error('KV namespace not bound');
  }

  try {
    const data = {
      jobId,
      results,
      timestamp: new Date().toISOString(),
      cachedAt: Date.now()
    };

    await KV.put(
      `analysis:${jobId}`,
      JSON.stringify(data),
      {
        expirationTtl: CACHE_TTL_SECONDS
      }
    );

    return { success: true, jobId };
  } catch (error) {
    console.error('Failed to save results to KV:', error);
    throw new Error(`Cache save failed: ${error.message}`);
  }
}

export async function getResults(jobId, KV) {
  if (!KV) {
    throw new Error('KV namespace not bound');
  }

  try {
    const cached = await KV.get(`analysis:${jobId}`, { type: 'text' });
    
    if (!cached) {
      return null;
    }

    const data = JSON.parse(cached);
    
    const age = Date.now() - data.cachedAt;
    const maxAge = CACHE_TTL_SECONDS * 1000;
    
    if (age > maxAge) {
      await KV.delete(`analysis:${jobId}`);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Failed to retrieve results from KV:', error);
    return null;
  }
}

export async function deleteResults(jobId, KV) {
  if (!KV) {
    throw new Error('KV namespace not bound');
  }

  try {
    await KV.delete(`analysis:${jobId}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to delete results from KV:', error);
    throw new Error(`Cache delete failed: ${error.message}`);
  }
}

export async function saveStyledSummary(jobId, style, summary, KV) {
  if (!KV) {
    throw new Error('KV namespace not bound');
  }

  try {
    const key = `summary:${jobId}:${style}`;
    const data = {
      jobId,
      style,
      summary,
      timestamp: new Date().toISOString(),
      cachedAt: Date.now()
    };

    await KV.put(
      key,
      JSON.stringify(data),
      {
        expirationTtl: CACHE_TTL_SECONDS
      }
    );

    return { success: true };
  } catch (error) {
    console.error('Failed to save styled summary to KV:', error);
    throw new Error(`Summary cache save failed: ${error.message}`);
  }
}

export async function getStyledSummary(jobId, style, KV) {
  if (!KV) {
    throw new Error('KV namespace not bound');
  }

  try {
    const key = `summary:${jobId}:${style}`;
    const cached = await KV.get(key, { type: 'text' });
    
    if (!cached) {
      return null;
    }

    const data = JSON.parse(cached);
    
    const age = Date.now() - data.cachedAt;
    const maxAge = CACHE_TTL_SECONDS * 1000;
    
    if (age > maxAge) {
      await KV.delete(key);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Failed to retrieve styled summary from KV:', error);
    return null;
  }
}
```