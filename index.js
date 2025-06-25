const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = 3000;

const db = require('./db');

app.get('/', (req, res) => {
  res.send(`<a href="https://id.twitch.tv/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${process.env.REDIRECT_URI}&response_type=code&scope=channel:read:vips">Login com Twitch</a>`);
});

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

// Salvar no banco de dados
await db.read();
db.data.twitch_auth = {
  access_token,
  refresh_token,
  expires_at: Date.now() + expires_in * 1000 // em milissegundos
};
await db.write();


    res.send(`✅ Token recebido com sucesso!<br><br><code>${access_token}</code>`);
  } catch (error) {
    console.error('Erro ao obter token:', error.response?.data || error.message);
    res.status(500).send('❌ Erro ao obter o token de acesso.');
  }
  

await db.read();
db.data.usuarios.push({
  discord_id: discordUser.id,
  twitch_id: req.session.twitch_id
});
await db.write();

});

import fs from 'fs/promises';

const raw = await fs.readFile('./vinculos.json');
const { twitch_auth } = JSON.parse(raw);

const accessToken = twitch_auth?.access_token;

app.get('/vips', async (req, res) => {

  try {
    const userInfo = await axios.get('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-ID': process.env.CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const broadcasterId = userInfo.data.data[0].id;

    const vipRes = await axios.get(`https://api.twitch.tv/helix/channels/vips?broadcaster_id=${broadcasterId}`, {
      headers: {
        'Client-ID': process.env.CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      }
    });

    res.json(vipRes.data);
  } catch (error) {
    console.error('Erro ao buscar VIPs:', error.response?.data || error.message);
    res.status(500).send('❌ Erro ao buscar VIPs do canal.');
  }
});


app.get('/auth/discord', (req, res) => {
  const redirect = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}&response_type=code&scope=identify`;
  res.redirect(redirect);
})

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

    res.send(`✅ Conta Discord vinculada com sucesso!<br>ID: <code>${discordUser.id}</code><br>Usuário: ${discordUser.username}#${discordUser.discriminator}`);
  } catch (err) {
    console.error('Erro no callback do Discord:', err.response?.data || err.message);
    res.status(500).send('❌ Erro ao autenticar com Discord');
  }

// Exemplo de uso:
await db.read();
db.data.usuarios.push({
  discord_id: discordUser.id,
  twitch_id: 'ID_TWITCH_DO_USUARIO' // ← Substitua pelo que armazenou antes
});
await db.write();

});

const session = require('express-session');

app.use(session({
  secret: 'uma_chave_secreta_qualquer',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // true se usar HTTPS
}));

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
