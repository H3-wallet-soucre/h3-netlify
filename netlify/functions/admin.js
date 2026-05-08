export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }});
  }

  // Inline admin HTML
  const adminHtml = await import('./admin-html.js').then(m => m.default);

  return new Response(adminHtml, {
    headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache, no-store' }
  });
}

export const config = { path: "/admin" };
