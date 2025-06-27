import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client, GatewayIntentBits } from 'discord.js';
import { renovarTokenTwitch } from './twitchService.js';
import Usuario from './models/Usuario.js';
import Resg from './models/Resg.js';
import Reward from './models/Reward.js';
import axios from 'axios';
import Canal from './models/Canal.js';
import authRoutes from './auth.mjs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const redirect_uri = process.env.REDIRECT_URI;

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('🔌 Conectado ao MongoDB');

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  const app = express();

  app.use(session({
    secret: 'novobot-super-secreto',
    resave: false,
    saveUninitialized: true
  }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static('public'));
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(authRoutes);

  // 🌐 Página inicial
app.get('/', (req, res) => {
  res.render('index', { twitchUser: req.session.twitchUser });;// <- Corrigido aqui
});


  // 🛒 Loja
app.get('/loja', async (req, res) => {
  const usuario = await Usuario.findById(req.session.userId);
  res.render('loja', {
    usuario,
    twitchUser: req.session.twitchUser
  });
});



app.get('/perfil', async (req, res) => {
  if (!req.session.userId) return res.redirect('/');

  const usuario = await Usuario.findById(req.session.userId);
  if (!usuario) return res.redirect('/');

  res.render('perfil', {
    twitchUser: req.session.twitchUser,
    usuario, // 👈 ESSENCIAL!
    twitchId: usuario.twitch_id,
    pontos: usuario.pontos,
    email: usuario.email,
    criadoEm: formatarData(usuario.createdAt)
  });
});


  // 🎁 Resgate
  app.post('/resgatar', async (req, res) => {
    const { item, custo } = req.body;
    if (!req.session.userId) return res.status(401).json({ erro: 'Não autenticado' });

    const usuario = await Usuario.findById(req.session.userId);
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });
    if (usuario.pontos < custo) {
      return res.status(400).json({ erro: 'Pontos insuficientes' });
    }

    usuario.pontos -= custo;
    await usuario.save();

    await Resg.create({
      user: usuario._id,
      reward: item,
    });

    res.json({ sucesso: true, novaPontuacao: usuario.pontos });
  });

  // 🔗 Início da autenticação Twitch
  app.get('/vincular', (req, res) => {
    const twitchURL = `https://id.twitch.tv/oauth2/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent(redirect_uri)}&response_type=code&scope=user:read:email`;
    res.redirect(twitchURL);
  });

  // 🎮 Callback Twitch
  app.get('/auth/twitch/callback', async (req, res) => {
    console.log('🚦 Callback da Twitch');
    const code = req.query.code;
    if (!code) return res.status(400).send('❌ Código de autorização ausente.');

    try {
      const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id,
          client_secret,
          code,
          grant_type: 'authorization_code',
          redirect_uri
        }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const tokenData = await tokenResponse.json();
      const { access_token, refresh_token, expires_in } = tokenData;

      if (!access_token) {
        console.error('❌ Erro ao obter token:', tokenData);
        return res.status(400).send('Erro ao obter token de acesso da Twitch.');
      }

      const userRes = await axios.get('https://api.twitch.tv/helix/users', {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Client-ID': client_id
        }
      });

      const twitchData = userRes.data?.data?.[0];
      if (!twitchData) return res.status(400).send('❌ Não foi possível obter informações da conta da Twitch.');

      const twitchId = twitchData.id;
      const displayName = twitchData.display_name;

      if (twitchId === process.env.OWNER_TWITCH_ID) {
        await Canal.findOneAndUpdate(
          { twitch_id: twitchId },
          {
            access_token,
            refresh_token,
            expires_at: new Date(Date.now() + expires_in * 1000)
          },
          { upsert: true }
        );
        console.log('📦 Token do canal salvo');
      }

      let usuario = await Usuario.findOne({ twitch_id: twitchId });
      if (!usuario) {
        usuario = await Usuario.create({
          twitch_id: twitchId,
          nome_twitch: displayName,
          pontos: 500
        });
      } else {
        usuario.nome_twitch = displayName;
        await usuario.save();
      }

      // 🔒 Sessão correta salva aqui
      req.session.twitchUser = usuario.nome_twitch;
      req.session.userId = usuario._id;

      res.redirect('/');
    } catch (err) {
      console.error('❌ Erro ao vincular com a Twitch:', err.response?.data || err.message);
      res.status(500).send('Erro ao vincular conta Twitch.');
    }
  });

  app.set('discordClient', client);

  app.listen(3000, () => {
    console.log('🚀 Servidor rodando em http://localhost:3000');
  });

  client.login(process.env.DISCORD_TOKEN);
  renovarTokenTwitch();
  setInterval(() => renovarTokenTwitch(), 600_000);
}

main().catch((err) => {
  console.error('❌ Erro ao iniciar o servidor:', err);
});
