// 零依赖 HTTP 工具：带超时、重试、浏览器 UA、降级
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function request(url, { headers = {}, method = 'GET', body, timeoutMs = 15000, retries = 2, retryDelayMs = 2000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method,
          body,
          signal: ctrl.signal,
          redirect: 'follow',
          headers: {
            'User-Agent': UA,
            Accept: '*/*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            ...headers,
          },
        });
        if (res.status >= 400 && res.status !== 403) {
          const err = new Error(`HTTP ${res.status} for ${url}`);
          err.status = res.status;
          throw err;
        }
        return res;
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}

export async function getText(url, opts = {}) {
  const res = await request(url, opts);
  return res.text();
}

export async function getJson(url, opts = {}) {
  const res = await request(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  return res.json();
}
