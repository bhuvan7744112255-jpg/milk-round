// Server-only Supabase client. Uses the SERVICE ROLE key, which bypasses
// Row Level Security — that's intentional here (see supabase/schema.sql):
// every table denies the public/anon key entirely, and this client, running
// only inside Vercel serverless functions, is the sole path to the data.
// NEVER import this file from anything that ships to the browser.
const { createClient } = require('@supabase/supabase-js');

let client;

function supabaseAdmin() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

module.exports = { supabaseAdmin };
