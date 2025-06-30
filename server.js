// 🌐 Dependências principais
import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import session from 'express-session';
import path from 'path';
import fetch from 'node-fetch';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { Client, GatewayIntentBits } from 'discord.js';

// 🧠 Modelos e rotas
import Usuario from './models/Usuario.js';
import Resg from './models/Resg.js';
import Reward from './models/Reward.js';
import Canal from './models/Canal.js';
import ItemLoja from './models/ItemLoja.js';
import authRoutes from './auth.mjs';
import fs from 'fs';

// 🛠 Utilitários
import { renovarTokenTwitch } from './twitchService.js';

dotenv.config();

const router = express.Router();

// 📍 Diretório atual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🧩 Variáveis da Twitch
const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, MONGO_URI, OWNER_TWITCH_ID, DISCORD_TOKEN } = process.env;

// 🤖 Cliente Discord
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// 🚀 Estado do modo Double
const rodadaDouble = {
  status: 'apostando',
  tempoRestante: 15,
  historico: [],
  resultadoAtual: null
};


function gerarNumero(cor) {
  return cor === 'verde' ? 0 : Math.floor(Math.random() * 14) + 1;
}

function gerarNumeroEcor() {
  const roleta = [
    ...Array(7).fill().map(() => ({ cor: 'vermelho', numero: gerarNumero() })),
    ...Array(7).fill().map(() => ({ cor: 'preto', numero: gerarNumero() })),
    { cor: 'verde', numero: 0 }
  ];
  return roleta[Math.floor(Math.random() * roleta.length)];
}

// 🕒 Loop da roleta
setInterval(() => {
  if (rodadaDouble.status === 'apostando') {
    rodadaDouble.status = 'girando';
    const resultado = gerarNumeroEcor();
    rodadaDouble.resultadoAtual = resultado;
    rodadaDouble.historico.unshift(resultado);
    if (rodadaDouble.historico.length > 15) rodadaDouble.historico.pop();
    setTimeout(() => {
      rodadaDouble.status = 'apostando';
      rodadaDouble.tempoRestante = 15;
    }, 4000);
  } else {
    rodadaDouble.tempoRestante--;
  }
}, 1000);

// 📦 Função principal
async function main() {
  await mongoose.connect(MONGO_URI);
 console.log('📂 Nome do banco conectado:', mongoose.connection.name);

  const app = express();

  // 🔐 Middlewares
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

  // 🔀 Rotas e logs
  app.use((req, res, next) => {
    if (req.method === 'POST') {
      console.log('🧪 Body bruto (req.body):', req.body);
    }
    next();
  });

  app.use('/', authRoutes);

  app.get('/', (req, res) => {
    res.render('index', { twitchUser: req.session.twitchUser });
  });

  app.get('/double', (req, res) => {
    res.render('double', {
      usuario: res.locals.usuario,
      ocultarVincular: true
    });
  });

  app.get('/api/double', (req, res) => {
    res.json({
      status: rodadaDouble.status,
      tempo: rodadaDouble.tempoRestante,
      resultado: rodadaDouble.resultadoAtual,
      historico: rodadaDouble.historico
    });
  });

  app.get('/perfil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    const usuario = await Usuario.findById(req.session.userId);
    if (!usuario) return res.redirect('/');
    res.render('perfil', {
      twitchUser: req.session.twitchUser,
      usuario,
      twitchId: usuario.twitch_id,
      pontos: usuario.pontos,
      email: usuario.email,
      criadoEm: formatarData(usuario.createdAt)
    });
  });

app.get('/loja', async (req, res) => {
  const itens = await ItemLoja.find().sort({ criadoEm: -1 });

  let usuario = null;
  if (req.session?.userId) {
    usuario = await Usuario.findById(req.session.userId);
  }

  // Valida se o usuário logado é o dono
  const isOwner = usuario?.twitch_id === process.env.OWNER_TWITCH_ID;

  res.render('loja', {
    itens,
    usuario,
    twitchUser: req.session.twitchUser,
    isOwner
  });
});

app.post('/loja/criar', async (req, res) => {
  const { nome, preco, qtd } = req.body;

  try {
    if (!nome || !preco || !qtd) {
      return res.status(400).send('❌ Campos obrigatórios ausentes.');
    }

    await ItemLoja.create({
      nome: nome.trim(),
      preco: parseInt(preco),
      quantidade: parseInt(qtd)
    });

    console.log('✅ Item criado com sucesso!');
    res.redirect('/loja');
  } catch (err) {
    console.error('❌ Erro ao criar item:', err);
    res.status(500).send('Erro ao salvar no banco.');
  }
  const todos = await ItemLoja.find();
console.log('🧾 Itens atuais:', todos);
});

app.post('/api/loja/remover', async (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ sucesso: false, erro: 'ID não informado' });
  }

  try {
    const item = await ItemLoja.findByIdAndDelete(id);

    if (!item) {
      return res.status(404).json({ sucesso: false, erro: 'Item não encontrado no banco' });
    }

    console.log(`🗑️ Item removido com sucesso: ${item.nome}`);
    res.json({ sucesso: true });
  } catch (err) {
    console.error('❌ Erro ao deletar item:', err.message);
    res.status(500).json({ sucesso: false, erro: 'Erro interno no servidor' });
  }
});


app.post('/api/vips/salvar', async (req, res) => {
  try {
    const config = req.body;
    const caminho = new URL('./config-vips.json', import.meta.url);
    fs.writeFileSync(caminho, JSON.stringify(config, null, 2));
    console.log('💾 Configuração salva com sucesso!');
    res.json({ sucesso: true });
  } catch (err) {
    console.error('❌ Erro ao salvar:', err);
    res.status(500).json({ sucesso: false, erro: 'Erro ao salvar configuração' });
  }
});

app.post('/resgatar', async (req, res) => {
    const { item, custo } = req.body;
    if (!req.session.userId) return res.status(401).json({ erro: 'Não autenticado' });
    const usuario = await Usuario.findById(req.session.userId);
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });
    if (usuario.pontos < custo) return res.status(400).json({ erro: 'Pontos insuficientes' });
    usuario.pontos -= custo;
    await usuario.save();
    await Resg.create({ user: usuario._id, reward: item });
    res.json({ sucesso: true, novaPontuacao: usuario.pontos });
  });

  // 🔗 Twitch OAuth
  app.get('/vincular', (req, res) => {
    const twitchURL = `https://id.twitch.tv/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=user:read:email`;
    res.redirect(twitchURL);
  });

  app.get('/auth/twitch/callback', async (req, res) => {
    try {
      const code = req.query.code;
      if (!code) return res.status(400).send('❌ Código de autorização ausente.');

      const tokenData = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: REDIRECT_URI
        }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }).then(r => r.json());

      const access_token = tokenData.access_token;
      if (!access_token) {
        console.error('❌ Erro ao obter token:', tokenData);
        return res.status(400).send('Erro ao obter token de acesso da Twitch.');
      }

      const userData = await axios.get('https://api.twitch.tv/helix/users', {
        headers: {
          Authorization: `Bearer ${access_token}`,
          'Client-ID': CLIENT_ID
        }
      }).then(r => r.data.data?.[0]);

      if (!userData) return res.status(400).send('❌ Não foi possível obter informações da conta da Twitch.');

      const twitchId = userData.id;
      const displayName = userData.display_name;

      if (twitchId === OWNER_TWITCH_ID) {
        await Canal.findOneAndUpdate(
          { twitch_id: twitchId },
          {
            access_token,
            refresh_token: tokenData.refresh_token,
            expires_at: new Date(Date.now() + tokenData.expires_in * 1000)
          },
          { upsert: true }
        );
      }

      let usuario = await Usuario.findOne({ twitch_id: twitchId });
      if (!usuario) {
        usuario = await Usuario.create({ twitch_id: twitchId, nome_twitch: displayName, pontos: 500 });
      } else {
        usuario.nome_twitch = displayName;
        await usuario.save();
      }

      req.session.twitchUser = usuario.nome_twitch;
      req.session.userId = usuario._id;
      res.redirect('/');
    } catch (err) {
      console.error('❌ Erro no callback:', err);
      res.status(500).send('Erro no callback Twitch.');
    }
  });

  app.get('/dashboard/vips', async (req, res) => {
  // Aqui futuramente você pode buscar dados do Discord, se quiser
  res.render('dashboard-vips', {
    isOwner: true, // ou a lógica real para checar dono
    vips: []        // lista de configs futuras
  });
});

app.get('/api/discord/dados-vip', async (req, res) => {
  try {
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    await guild.roles.fetch();
    await guild.channels.fetch();

    const cargos = guild.roles.cache
      .filter(role => !role.managed)
      .map(role => ({
        id: role.id,
        nome: role.name
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome));

    const categorias = guild.channels.cache
      .filter(channel => channel.type === 4) // 4 = categoria no Discord.js v14
      .map(c => ({
        id: c.id,
        nome: c.name
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome));

    res.json({ sucesso: true, cargos, categorias });
  } catch (err) {
    console.error('❌ Erro ao buscar dados do Discord:', err);
    res.status(500).json({ sucesso: false, erro: 'Erro ao buscar dados do Discord' });
  }
});

  app.set('discordClient', client);

  app.listen(3000, () => {
    console.log('🚀 Servidor rodando em http://localhost:3000');
  });

  client.login(DISCORD_TOKEN);
  renovarTokenTwitch();
  setInterval(() => renovarTokenTwitch(), 600_000);
}

main().catch(err => {
  console.error('❌ Erro ao iniciar o servidor:', err);
});
