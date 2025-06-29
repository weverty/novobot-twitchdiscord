const express = require('express');
const session = require('express-session');
const axios = require('axios');
const db = require('./db');
require('dotenv').config();

const app = express();
const PORT = 3000;

// 💾 Sessão deve vir logo no topo
app.use(session({
  secret: 'uma_chave_secreta_qualquer',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// 🌍 Torna o ID do dono acessível no EJS
app.locals.OWNER_TWITCH_ID = process.env.OWNER_TWITCH_ID;

// 🌐 Middleware global para deixar usuario acessível em todas as views
app.use(async (req, res, next) => {
  await db.read();

  if (req.session.userId) {
    const usuario = db.data.usuarios.find(u => u.twitch_id === req.session.userId);
    res.locals.usuario = usuario || null;
  } else {
    res.locals.usuario = null;
  }

  next();
});

// 🌐 Rota Home com botão de login
app.get('/', (req, res) => {
  const botaoLogin = `<a href="https://id.twitch.tv/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${process.env.REDIRECT_URI}&response_type=code&scope=channel:read:vips">Login com Twitch</a>`;
  res.render('index'); // agora carrega o layout com navbar
  res.send(botaoLogin);
});

// 🎮 Callback Twitch
app.get('/auth/twitch/callback', async (req, res) => {
  const code = req.query.code;

  try {
    const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.REDIRECT_URI
      }
    });

    const { access_token, refresh_token, expires_in } = response.data;

    // 📌 Simulação de ID do usuário (substitua depois por chamada real à Twitch)
    const twitchUserId = 'simulado_123'; // você pode buscar isso via API: helix/users

    await db.read();
    const existente = db.data.usuarios.find(u => u.twitch_id === twitchUserId);
    if (!existente) {
      db.data.usuarios.push({
        twitch_id: twitchUserId,
        discord_id: null
      });
      await db.write();
    }

    // ✅ Salva sessão
    req.session.userId = twitchUserId;
    console.log('🔐 Sessão salva:', twitchUserId);

    res.send('✅ Login com Twitch bem-sucedido!');
  } catch (error) {
    console.error('Erro ao obter token:', error.response?.data || error.message);
    res.status(500).send('❌ Erro ao autenticar com a Twitch.');
  }
});

// 🔓 Login com Discord (opcional)
app.get('/auth/discord', (req, res) => {
  const redirect = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}&response_type=code&scope=identify`;
  res.redirect(redirect);
});

app.get('/auth/discord/callback', async (req, res) => {
  const code = req.query.code;

  try {
    const tokenRes = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
        scope: 'identify'
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    const { access_token } = tokenRes.data;

    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const discordUser = userRes.data;

    await db.read();
    const user = db.data.usuarios.find(u => u.twitch_id === req.session.userId);
    if (user) {
      user.discord_id = discordUser.id;
      await db.write();
    }

    res.send(`✅ Discord vinculado com sucesso! (${discordUser.username}#${discordUser.discriminator})`);
  } catch (err) {
    console.error('Erro no callback do Discord:', err.response?.data || err.message);
    res.status(500).send('❌ Erro ao autenticar com Discord');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
