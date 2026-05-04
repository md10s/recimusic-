const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// ── Helper: Supabase REST ───────────────────────────────────────
async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${options.token || SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
      ...options.headers,
    },
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}

// ── Helper: Supabase Auth ───────────────────────────────────────
async function sbAuth(endpoint, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${endpoint}`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await res.json() };
}

// ════════════════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════════════════

// POST /api/auth/register  { email, password, username }
app.post('/api/auth/register', async (req, res) => {
  const { email, password, username } = req.body;
  if (!email || !password || !username)
    return res.status(400).json({ error: 'Faltan campos requeridos.' });

  const auth = await sbAuth('/signup', { email, password });
  if (!auth.ok) return res.status(400).json({ error: auth.data.msg || 'Error al registrarse.' });

  const userId = auth.data.user?.id;
  if (!userId) return res.status(400).json({ error: 'No se pudo crear el usuario.' });

  const profile = await sbFetch('/profiles', {
    method: 'POST',
    body: JSON.stringify({ id: userId, username }),
  });

  if (!profile.ok) return res.status(400).json({ error: 'El nombre de usuario ya existe.' });

  res.json({ user: auth.data.user, session: { access_token: auth.data.session?.access_token }, username });
});

// POST /api/auth/login  { email, password }
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email y contraseña requeridos.' });

  const auth = await sbAuth('/token?grant_type=password', { email, password });
  if (!auth.ok) return res.status(400).json({ error: 'Email o contraseña incorrectos.' });

  const profile = await sbFetch(`/profiles?id=eq.${auth.data.user.id}&select=username`);
  const username = profile.data?.[0]?.username || '';

  res.json({ user: auth.data.user, session: { access_token: auth.data.access_token }, username });
});

// POST /api/auth/logout
app.post('/api/auth/logout', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` },
    });
  }
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════
//  REVIEWS
// ════════════════════════════════════════════════════════════════

// POST /api/reviews
app.post('/api/reviews', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autenticado.' });

  const { setlistfm_id, artist_name, venue_name, city, country,
          event_date, tour_name, song_count, setlist_data, rating, body } = req.body;

  // Verificar usuario
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` },
  });
  const user = await userRes.json();
  if (!user.id) return res.status(401).json({ error: 'Token inválido.' });

  // Buscar o crear el concert
  let concert;
  const searchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/concerts?setlistfm_id=eq.${encodeURIComponent(setlistfm_id)}&select=id`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const searchData = await searchRes.json();

  if (searchData && searchData.length > 0) {
    concert = searchData[0];
  } else {
    const concertRes = await fetch(`${SUPABASE_URL}/rest/v1/concerts`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({ setlistfm_id, artist_name, venue_name, city, country,
                             event_date, tour_name, song_count, setlist_data }),
    });
    const concertText = await concertRes.text();
    let concertData;
    try { concertData = JSON.parse(concertText); }
    catch { return res.status(500).json({ error: 'Error al guardar el show.', detail: concertText }); }
    if (!concertRes.ok) {
      console.error('[Concert error]', concertData);
      return res.status(500).json({ error: 'Error al guardar el show.', detail: concertData });
    }
    concert = Array.isArray(concertData) ? concertData[0] : concertData;
  }

  if (!concert?.id) return res.status(500).json({ error: 'No se pudo obtener el ID del show.' });

  // Upsert review con token del usuario
  const reviewRes = await fetch(`${SUPABASE_URL}/rest/v1/reviews`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({ concert_id: concert.id, user_id: user.id, rating, body }),
  });

  const reviewText = await reviewRes.text();
  let reviewData;
  try { reviewData = JSON.parse(reviewText); }
  catch { return res.status(500).json({ error: 'Error al guardar la reseña.', detail: reviewText }); }

  if (!reviewRes.ok) {
    console.error('[Review error]', reviewData);
    return res.status(500).json({ error: 'Error al guardar la reseña.', detail: reviewData });
  }

  res.json({ ok: true, review: Array.isArray(reviewData) ? reviewData[0] : reviewData });
});

// GET /api/reviews/concert/:setlistfm_id  — reseñas públicas de un show
app.get('/api/reviews/concert/:setlistfm_id', async (req, res) => {
  const { setlistfm_id } = req.params;

  // Buscar el concert
  const concertRes = await sbFetch(
    `/concerts?setlistfm_id=eq.${encodeURIComponent(setlistfm_id)}&select=id`
  );
  if (!concertRes.ok || !concertRes.data?.length) return res.json([]);
  const concertId = concertRes.data[0].id;

  // Traer reseñas con profile (username)
  const result = await sbFetch(
    `/reviews?concert_id=eq.${concertId}&select=*,profiles(username)&order=created_at.desc&limit=20`
  );
  res.json(result.data || []);
});

// GET /api/popular — concerts con más reseñas
app.get('/api/popular', async (req, res) => {
  // Traer los 20 concerts más recientes que tengan al menos una reseña
  try {
    const result = await sbFetch(
      `/concerts?select=*,reviews(count)&order=created_at.desc&limit=20`
    );
    if (!result.ok) return res.status(500).json({ error: 'Error al obtener populares.' });

    // Filtrar los que tengan al menos 1 reseña y ordenar por cantidad
    const concerts = (result.data || [])
      .filter(c => c.reviews?.[0]?.count > 0)
      .sort((a, b) => (b.reviews?.[0]?.count || 0) - (a.reviews?.[0]?.count || 0))
      .slice(0, 6)
      .map(c => ({ ...c, review_count: c.reviews?.[0]?.count || 0 }));

    // Si no hay suficientes con reseñas, completar con recientes
    if (concerts.length < 4) {
      const recent = (result.data || [])
        .filter(c => !concerts.find(x => x.id === c.id))
        .slice(0, 6 - concerts.length)
        .map(c => ({ ...c, review_count: 0 }));
      concerts.push(...recent);
    }

    res.json(concerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reviews/me
app.get('/api/reviews/me', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autenticado.' });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` },
  });
  const user = await userRes.json();
  if (!user.id) return res.status(401).json({ error: 'Token inválido.' });

  const result = await sbFetch(
    `/reviews?user_id=eq.${user.id}&select=*,concerts(*)&order=created_at.desc`,
    { token }
  );
  res.json(result.data || []);
});


// ════════════════════════════════════════════════════════════════
//  FOLLOWS / AMIGOS
// ════════════════════════════════════════════════════════════════

async function getUserFromToken(token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` },
  });
  return await res.json();
}

app.post('/api/follows/:username', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autenticado.' });
  const user = await getUserFromToken(token);
  if (!user.id) return res.status(401).json({ error: 'Token inválido.' });
  const target = await sbFetch(`/profiles?username=eq.${encodeURIComponent(req.params.username)}&select=id`);
  if (!target.data?.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const followingId = target.data[0].id;
  if (followingId === user.id) return res.status(400).json({ error: 'No podés seguirte a vos mismo.' });
  const result = await sbFetch('/follows', {
    method: 'POST', token,
    headers: { 'Prefer': 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ follower_id: user.id, following_id: followingId }),
  });
  if (!result.ok) return res.status(400).json({ error: 'Error al seguir usuario.', detail: result.data });
  res.json({ ok: true });
});

app.delete('/api/follows/:username', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autenticado.' });
  const user = await getUserFromToken(token);
  if (!user.id) return res.status(401).json({ error: 'Token inválido.' });
  const target = await sbFetch(`/profiles?username=eq.${encodeURIComponent(req.params.username)}&select=id`);
  if (!target.data?.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const followingId = target.data[0].id;
  await sbFetch(`/follows?follower_id=eq.${user.id}&following_id=eq.${followingId}`, { method: 'DELETE', token });
  res.json({ ok: true });
});

app.get('/api/follows/me', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autenticado.' });
  const user = await getUserFromToken(token);
  if (!user.id) return res.status(401).json({ error: 'Token inválido.' });
  const [following, followers] = await Promise.all([
    sbFetch(`/follows?follower_id=eq.${user.id}&select=following_id,profiles!follows_following_id_fkey(username)`),
    sbFetch(`/follows?following_id=eq.${user.id}&select=follower_id,profiles!follows_follower_id_fkey(username)`),
  ]);
  res.json({
    following: (following.data || []).map(f => ({ id: f.following_id, username: f.profiles?.username })),
    followers: (followers.data || []).map(f => ({ id: f.follower_id, username: f.profiles?.username })),
  });
});

app.get('/api/follows/feed', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autenticado.' });
  const user = await getUserFromToken(token);
  if (!user.id) return res.status(401).json({ error: 'Token inválido.' });
  const followingRes = await sbFetch(`/follows?follower_id=eq.${user.id}&select=following_id`);
  const ids = (followingRes.data || []).map(f => f.following_id);
  if (!ids.length) return res.json([]);
  const inClause = `(${ids.map(id => `"${id}"`).join(',')})`;
  const feed = await sbFetch(
    `/reviews?user_id=in.${inClause}&select=*,profiles(username),concerts(artist_name,venue_name,city,event_date,tour_name,setlistfm_id)&order=created_at.desc&limit=30`
  );
  res.json(feed.data || []);
});

app.get('/api/users/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.status(400).json({ error: 'Mínimo 2 caracteres.' });
  const token = req.headers.authorization?.replace('Bearer ', '');
  let myId = null;
  if (token) { const u = await getUserFromToken(token); myId = u.id || null; }
  const result = await sbFetch(`/profiles?username=ilike.*${encodeURIComponent(q.trim())}*&select=id,username&limit=10`);
  const users = (result.data || []).filter(u => u.id !== myId);
  if (myId && users.length) {
    const followingRes = await sbFetch(`/follows?follower_id=eq.${myId}&select=following_id`);
    const followingIds = new Set((followingRes.data || []).map(f => f.following_id));
    users.forEach(u => u.is_following = followingIds.has(u.id));
  }
  res.json(users);
});

app.get('/api/users/:username/common', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autenticado.' });
  const user = await getUserFromToken(token);
  if (!user.id) return res.status(401).json({ error: 'Token inválido.' });
  const target = await sbFetch(`/profiles?username=eq.${encodeURIComponent(req.params.username)}&select=id`);
  if (!target.data?.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const targetId = target.data[0].id;
  const [myReviews, theirReviews] = await Promise.all([
    sbFetch(`/reviews?user_id=eq.${user.id}&select=concert_id,rating`),
    sbFetch(`/reviews?user_id=eq.${targetId}&select=concert_id,rating`),
  ]);
  const myMap = new Map((myReviews.data || []).map(r => [r.concert_id, r.rating]));
  const commonIds = (theirReviews.data || []).filter(r => myMap.has(r.concert_id)).map(r => r.concert_id);
  if (!commonIds.length) return res.json([]);
  const concerts = await sbFetch(`/concerts?id=in.(${commonIds.join(',')})&select=id,artist_name,venue_name,city,event_date,setlistfm_id`);
  res.json((concerts.data || []).map(c => ({
    ...c,
    my_rating: myMap.get(c.id),
    their_rating: (theirReviews.data || []).find(r => r.concert_id === c.id)?.rating,
  })));
});

// ════════════════════════════════════════════════════════════════
//  SETLIST.FM PROXY
// ════════════════════════════════════════════════════════════════

app.get('/api/search', async (req, res) => {
  const { q, p = 1 } = req.query;
  if (!q || q.trim().length < 2)
    return res.status(400).json({ error: 'El parámetro "q" es requerido (mínimo 2 caracteres).' });

  const apiKey = process.env.SETLISTFM_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Falta SETLISTFM_KEY en el archivo .env' });

  try {
    const url = `https://api.setlist.fm/rest/1.0/search/setlists?artistName=${encodeURIComponent(q)}&p=${p}`;
    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey, 'Accept': 'application/json' },
    });
    if (!response.ok) {
      const text = await response.text();
      console.error(`[Setlist.fm] ${response.status}:`, text);
      return res.status(response.status).json({ error: `Error de Setlist.fm: ${response.status}` });
    }
    res.json(await response.json());
  } catch (err) {
    console.error('[Proxy error]', err.message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

app.get('/api/setlist/:id', async (req, res) => {
  const apiKey = process.env.SETLISTFM_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Falta SETLISTFM_KEY en el archivo .env' });
  try {
    const url = `https://api.setlist.fm/rest/1.0/setlist/${req.params.id}`;
    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey, 'Accept': 'application/json' },
    });
    if (!response.ok) return res.status(response.status).json({ error: `Error ${response.status}` });
    res.json(await response.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ════════════════════════════════════════════════════════════════
//  INICIAR
// ════════════════════════════════════════════════════════════════

async function ensureFollowsTable() {
  // Intentar insertar un registro inválido — si la tabla no existe, el error lo dice
  const check = await sbFetch('/follows?limit=1');
  if (check.status === 404 || (typeof check.data === 'string' && check.data.includes('does not exist'))) {
    console.log('  ⚙️  Tabla follows no existe — creándola vía Supabase Management API...');
    // Crear via SQL REST endpoint (solo disponible con service_role key)
    const sql = `
      CREATE TABLE IF NOT EXISTS follows (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        follower_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
        following_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
        created_at timestamptz DEFAULT now(),
        UNIQUE(follower_id, following_id)
      );
      ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='follows' AND policyname='follows_select') THEN
          CREATE POLICY follows_select ON follows FOR SELECT USING (true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='follows' AND policyname='follows_insert') THEN
          CREATE POLICY follows_insert ON follows FOR INSERT WITH CHECK (auth.uid() = follower_id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='follows' AND policyname='follows_delete') THEN
          CREATE POLICY follows_delete ON follows FOR DELETE USING (auth.uid() = follower_id);
        END IF;
      END $$;
    `;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    });
    if (res.ok) console.log('  ✅  Tabla follows creada correctamente.');
    else console.log('  ⚠️  No se pudo crear la tabla follows automáticamente. Creala manualmente en Supabase SQL Editor.');
  } else {
    console.log('  ✅  Tabla follows OK.');
  }
}

app.listen(PORT, async () => {
  await ensureFollowsTable();
  console.log('');
  console.log('  ██████ ███████ ████████ ██       ██████   ██████  ');
  console.log('  ██      ██        ██    ██      ██    ██ ██       ');
  console.log('  ███████ █████     ██    ██      ██    ██ ██   ███ ');
  console.log('       ██ ██        ██    ██      ██    ██ ██    ██ ');
  console.log('  ██████  ███████   ██    ███████  ██████   ██████  ');
  console.log('');
  console.log(`  🎸 Servidor corriendo en → http://localhost:${PORT}`);
  console.log(`  📡 API proxy activo       → /api/search?q=ARTISTA`);
  console.log(`  🔐 Auth activo            → /api/auth/register | /api/auth/login`);
  console.log('');
});
