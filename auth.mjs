import mongoose from 'mongoose';
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import Usuario from './models/Usuario.js';
import Canal from './models/Canal.js';
import auth from 'basic-auth';
import Resgate from './models/Resgate.js';
import formidableMiddleware from 'express-formidable';
import fetch from 'node-fetch';
import { protegerPainelTwitch } from './middlewares.mjs';
import { EmbedBuilder } from 'discord.js';
import ItemLoja from './models/ItemLoja.js';

const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const redirect_uri = process.env.REDIRECT_URI;
const app = express();
dotenv.config();
const router = express.Router();
router.use(formidableMiddleware());

app.use(express.urlencoded({ extended: true }));



// 🔐 Middleware de autenticação básica
const protegerPainel = (req, res, next) => {
  const user = auth(req);
  const usuarioCorreto = process.env.ADMIN_USER;
  const senhaCorreta = process.env.ADMIN_PASS;

  if (!user || user.name !== usuarioCorreto || user.pass !== senhaCorreta) {
    res.set('WWW-Authenticate', 'Basic realm="Painel VIP"');
    return res.status(401).send('🔒 Acesso restrito');
  }

  next();
};




// 🔗 Início da vinculação com Discord ID
router.get('/vincular', (req, res) => {
  const { discord_id } = req.query;

  const redirectUri = 'http://localhost:3000/auth/twitch/callback';
  const clientId = process.env.CLIENT_ID;
  const scope = 'user:read:email channel:read:vips channel:manage:vips';

  const authUrl = `https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${discord_id}`;
  console.log('🔎 URL gerada:', authUrl);
  res.redirect(authUrl);
  
});


// 🎮 Callback do login Twitch
router.get('/auth/twitch/callback', async (req, res) => {
  
  const code = req.query.code;
  const state = req.query.state;

  // 🔍 Decodificar dados do Discord a partir do state
  let discordId = null;
  let nomeDiscord = null;

if (state && state !== 'undefined') {
  try {
    const decoded = JSON.parse(Buffer.from(decodeURIComponent(state), 'base64').toString());
    discordId = decoded.discord_id;
    nomeDiscord = decoded.nome_discord;
    console.log('🧩 Dados do Discord via state:', discordId, nomeDiscord);
  } catch (e) {
    console.warn('⚠️ state inválido ou corrompido. Ignorando.'); // Limpa o log técnico
  }
}


  if (!code) return res.status(400).send('❌ Código de autorização ausente.');

  try {
    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.REDIRECT_URI
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const tokenData = await tokenResponse.json();
    const { access_token, refresh_token, expires_in } = tokenData;

    if (!access_token) {
      console.error('❌ Erro ao obter token:', tokenData);
      return res.status(400).send('Erro ao obter token de acesso da Twitch.');
    }

    // 🔎 Pega dados do usuário da Twitch
    const userRes = await axios.get('https://api.twitch.tv/helix/users', {
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Client-ID': process.env.CLIENT_ID
      }
    });

    const twitchData = userRes.data?.data?.[0];
    if (!twitchData) return res.status(400).send('❌ Não foi possível obter informações da conta da Twitch.');

    const twitchId = twitchData.id;
    const displayName = twitchData.display_name;

    const validDiscordId = discordId && discordId !== 'undefined';
    const validNomeDiscord = nomeDiscord && nomeDiscord !== 'undefined';

    let usuario = await Usuario.findOne({
      $or: [
        { twitch_id: twitchId },
        ...(validDiscordId ? [{ discord_id: discordId }] : [])
      ]
    });

    if (!usuario) {
      usuario = await Usuario.create({
        twitch_id: twitchId,
        nome_twitch: displayName,
        pontos: 500,
        ...(validDiscordId && { discord_id: discordId }),
        ...(validNomeDiscord && { nome_discord: nomeDiscord })
      });
    } else {
      usuario.twitch_id = twitchId;
      usuario.nome_twitch = displayName;
      if (validDiscordId) usuario.discord_id = discordId;
      if (validNomeDiscord) usuario.nome_discord = nomeDiscord;
      await usuario.save();
    }

    // Salvar tokens se for o canal principal
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
    }


    if (usuario.banido) {
  req.session.userId = null; // limpa sessão
  return res.render('banido', {
    nome: usuario.nome_twitch || 'Usuário'
  });
}



    // Salvar na sessão
    req.session.twitchUser = usuario.nome_twitch;
    req.session.userId = usuario._id;

    res.redirect('/');
  } catch (err) {
    console.error('❌ Erro no callback Twitch:', err.response?.data || err.message);
    res.status(500).send('Erro ao autenticar com a Twitch.');
  }
});


// 🚪 Logout
router.get('/logout', async (req, res) => {
  let usuario = null;
  let twitchUser = null;

  if (req.session.userId) {
    usuario = await Usuario.findById(req.session.userId);
    twitchUser = usuario?.nome_twitch;
  }

  res.render('logout', { usuario, twitchUser });
});


router.get('/painel', protegerPainel, async (req, res) => {
  const usuarios = await Usuario.find();
  const guild = await req.app.get('discordClient').guilds.fetch(process.env.DISCORD_GUILD_ID);

  const vips = {};
  for (const u of usuarios) {
    try {
      const member = await guild.members.fetch(u.discord_id);
      vips[u.discord_id] = member.roles.cache.has(process.env.DISCORD_ROLE_ID);
    } catch {
      vips[u.discord_id] = false;
    }
  }

  const usuario = res.locals.usuario;
  const twitchUser = usuario?.nome_twitch;
  const mensagem = req.query.ok ? 'Ação concluída com sucesso!' : null;

  res.render('painel', { usuarios, vips, usuario, twitchUser, mensagem });
});


router.get('/banir/:id', protegerPainel, async (req, res) => {
  try {
    const userId = req.params.id;

    // Atualiza e busca o usuário atualizado
    const usuario = await Usuario.findByIdAndUpdate(userId, { banido: true }, { new: true });

    console.log('✅ Usuário banido:', userId);

    // Dados adicionais (Twitch e Discord)
    const canal = await Canal.findOne({ twitch_id: process.env.OWNER_TWITCH_ID });
    const token = canal?.access_token;
    let nomeTwitch = 'Não encontrado';

    if (token && usuario.twitch_id) {
      try {
        const resTwitch = await axios.get('https://api.twitch.tv/helix/users', {
          params: { id: usuario.twitch_id },
          headers: {
            Authorization: `Bearer ${token}`,
            'Client-ID': process.env.CLIENT_ID
          },
          timeout: 5000
        });
        nomeTwitch = resTwitch.data.data[0]?.display_name || 'Desconhecido';
      } catch (err) {
        console.warn('⚠️ Erro ao buscar Twitch:', err.message);
      }
    }

    const guild = await req.app.get('discordClient').guilds.fetch(process.env.DISCORD_GUILD_ID);
    const membro = await guild.members.fetch(usuario.discord_id).catch(() => null);
    const nomeDiscord = membro?.user?.tag || 'Desconhecido';

    const canalLog = await req.app.get('discordClient').channels.fetch(process.env.DISCORD_LOG_CHANNEL_ID);
    if (canalLog?.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle('🚫 Usuário Banido pelo Painel')
        .setColor(0xff0000)
        .addFields(
          { name: '📌 Discord', value: `\`${usuario.discord_id}\` (${nomeDiscord})`, inline: false },
          { name: '🎮 Twitch', value: `\`${usuario.twitch_id}\` (${nomeTwitch})`, inline: false },
          { name: '📝 Motivo', value: 'Banido pelo painel do site', inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Ação executada pelo painel admin' });

      await canalLog.send({ embeds: [embed] });
    }

    // ✅ Agora sim: finaliza a requisição só após tudo
    return res.redirect('/painel?ok=banido');

  } catch (err) {
    console.error('❌ Erro ao banir:', err);
    return res.status(500).send('Erro ao banir');
  }
});


router.get('/desbanir/:id', protegerPainel, async (req, res) => {
  try {
    const userId = req.params.id;

    // Atualiza status de banimento
    const usuario = await Usuario.findByIdAndUpdate(userId, { banido: false }, { new: true });
    console.log('✅ Usuário desbanido:', userId);

    // Discord info
    const canalLog = await req.app.get('discordClient').channels.fetch(process.env.DISCORD_LOG_CHANNEL_ID);
    const guild = await req.app.get('discordClient').guilds.fetch(process.env.DISCORD_GUILD_ID);
    const membro = await guild.members.fetch(usuario.discord_id).catch(() => null);
    const nomeDiscord = membro?.user?.tag || 'Desconhecido';
    const nomeTwitch = usuario.nome_twitch || 'Desconhecido';

    // Envia embed
    if (canalLog?.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle('✅ Usuário Desbanido pelo Painel')
        .setColor(0x38a169)
        .addFields(
          { name: '📌 Discord', value: `\`${usuario.discord_id}\` (${nomeDiscord})`, inline: false },
          { name: '🎮 Twitch', value: `\`${usuario.twitch_id}\` (${nomeTwitch})`, inline: false },
          { name: '📝 Motivo', value: 'Desbanido pelo painel do site', inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Ação executada pelo painel admin' });

      await canalLog.send({ embeds: [embed] });
    }

    return res.redirect('/painel?ok=desbanido');
  } catch (err) {
    console.error('❌ Erro ao desbanir:', err);
    return res.status(500).send('Erro ao desbanir');
  }
});


// 🧨 Remoção completa: Mongo + Discord + Twitch
router.get('/remover/:discordId', protegerPainel, async (req, res) => {
  const { discordId } = req.params;

  try {
    const removido = await Usuario.findOneAndDelete({ discord_id: discordId });

    if (removido) {
      console.log(`🗑️ Usuário removido: ${discordId}`);

      // Remove do Discord
      try {
        const guild = await req.app.get('discordClient').guilds.fetch(process.env.DISCORD_GUILD_ID);
        const member = await guild.members.fetch(discordId);
        await member.roles.remove(process.env.DISCORD_ROLE_ID);
        console.log(`🚫 Cargo VIP removido no Discord para ${discordId}`);
      } catch (err) {
        console.warn(`⚠️ Discord: falha ao remover cargo:`, err.message);
      }

      // Remove da Twitch
      try {
        const canal = await Canal.findOne({ twitch_id: process.env.OWNER_TWITCH_ID });
        const token = canal?.access_token;
        const twitchId = removido.twitch_id;

        if (!token) {
          console.warn('⚠️ Token do canal não encontrado no Mongo');
        } else {
          await axios.delete('https://api.twitch.tv/helix/channels/vips', {
            params: {
              broadcaster_id: process.env.OWNER_TWITCH_ID,
              user_id: twitchId
            },
            headers: {
              'Client-ID': process.env.CLIENT_ID,
              'Authorization': `Bearer ${token}`
            }
          });
          console.log(`🟣 VIP removido na Twitch para ${twitchId}`);
        }
      } catch (err) {
        console.warn('⚠️ Twitch: falha ao remover VIP:', err.response?.data || err.message);
      }

      res.redirect('/painel?removido=1');
    } else {
      res.status(404).send('❌ Usuário não encontrado no banco de dados.');
    }
  } catch (err) {
    console.error('Erro geral ao remover vínculo:', err);
    res.status(500).send('⚠️ Erro interno ao remover o usuário.');
  }
});


router.get('/remover/:id', protegerPainel, async (req, res) => {
  const discordId = req.params.id;

  const usuario = await Usuario.findOne({ discord_id: discordId });

  // 🚫 Protege contra remoção de banidos
  if (usuario?.banido) {
    return res.status(403).send('🚫 Não é possível remover um vínculo de usuário banido. Desbanie primeiro!');
  }

  if (usuario) {
    await Usuario.deleteOne({ _id: usuario._id });
    res.redirect('/painel?removido=true');
  } else {
    res.status(404).send('Usuário não encontrado.');
  }
});



router.post('/resgatar', async (req, res) => {
 const { twitch_id, item, preco } = req.fields;


  if (!twitch_id || !item || !preco) {
    return res.status(400).send('❌ Dados incompletos.');
  }

  const usuario = await Usuario.findOne({ twitch_id });

  if (!usuario) {
    return res.status(404).send('Usuário não encontrado.');
  }

  if (usuario.pontos < preco) {
    return res.status(403).send('⚠️ Pontos insuficientes.');
  }

  usuario.pontos -= preco;
  await usuario.save();

  await Resgate.create({ usuario_id: usuario._id, item, preco });

  res.send(`✅ Você resgatou: "${item}" por ${preco} pontos!`);
  

  const webhookURL = process.env.DISCORD_WEBHOOK_RESGATES;

await fetch(webhookURL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    embeds: [{
      title: '🎁 Novo Resgate!',
      description: `**${usuario.nome_twitch}** (ID: \`${usuario.twitch_id}\`) resgatou **${item}** por **${preco} pontos**.`,
      color: 0x90ee90,
      timestamp: new Date().toISOString(),
      footer: { text: 'NovoBot • Loja de Recompensas' }
    }]
  })
});

});





router.get('/debug-client', (req, res) => {
  res.send(`
    <h2>🔍 Diagnóstico do CLIENT_ID</h2>
    <p><strong>process.env.CLIENT_ID:</strong> ${process.env.CLIENT_ID}</p>
    <p><strong>process.env.CLIENT_SECRET:</strong> ${process.env.CLIENT_SECRET ? '✅ Definido' : '❌ Vazio ou não definido'}</p>
  `);
});


router.get('/verificar-token', async (req, res) => {
  const canal = await Canal.findOne({ twitch_id: process.env.OWNER_TWITCH_ID });

  if (!canal?.access_token) {
    return res.status(400).send('❌ Nenhum token encontrado no banco');
  }

  try {
    const response = await axios.get('https://id.twitch.tv/oauth2/validate', {
      headers: {
        Authorization: `Bearer ${canal.access_token}`
      }
    });

    const info = response.data;
    res.send(`
      <h2>✅ Token válido</h2>
      <p><strong>Login:</strong> ${info.login}</p>
      <p><strong>User ID:</strong> ${info.user_id}</p>
      <p><strong>Client ID:</strong> ${info.client_id}</p>
      <p><strong>Expira em:</strong> ${info.expires_in} segundos</p>
      <p><strong>Escopos:</strong> ${info.scope ? info.scope.join(', ') : '(nenhum escopo listado)'}</p>
    `);
  } catch (err) {
    console.error('Erro ao validar token:', err.response?.data || err.message);
    res.status(401).send('❌ Token inválido ou expirado');
  }
});


router.get('/perfil', async (req, res) => {
  if (!req.session.userId) return res.redirect('/');

  const usuario = await Usuario.findById(req.session.userId);
  if (!usuario) return res.status(404).send('❌ Usuário não encontrado.');

  const avatarURL = `https://static-cdn.jtvnw.net/jtv_user_pictures/${usuario.twitch_id}-profile_image-300x300.png`;

  const status = usuario.twitch_id === process.env.OWNER_TWITCH_ID
    ? 'owner'
    : usuario.subscriber
    ? 'subscriber'
    : usuario.moderador
    ? 'moderador'
    : usuario.vip
    ? 'vip'
    : 'viewer';

  const statusCor = {
    owner: '#22c55e',
    subscriber: '#a855f7',
    moderador: '#3b82f6',
    vip: '#facc15',
    viewer: '#9ca3af'
  }[status];

  res.render('perfil', {
    usuario,
    twitchUser: req.session.twitchUser,
    avatarURL,
    status,
    statusCor
  });
});


router.post('/vincular-discord', async (req, res) => {
  const { discord_id, nome_discord } = req.body;

  if (!discord_id || !nome_discord) {
    return res.status(400).json({ erro: 'Dados incompletos' });
  }

  // ⚠️ Não criar usuário aqui
  // Apenas aceite os dados e confirme recebimento

  return res.json({ sucesso: true });
});



// 🔗 Login com Twitch
router.get('/auth/twitch/login', (req, res) => {
  const { discord_id, nome_discord } = req.query;

  // 🔐 Verificação de segurança
  if (!discord_id || !nome_discord) {
    return res.status(400).send('❌ Parâmetros do Discord ausentes. Use o link correto gerado pelo bot.');
  }

  const statePayload = JSON.stringify({ discord_id, nome_discord });
  const encodedState = encodeURIComponent(Buffer.from(statePayload).toString('base64'));

  const scopes = [
    'user:read:email',
    'channel:read:vips',
    'channel:manage:vips'
  ];

  const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes.join(' '))}&state=${encodedState}`;

  console.log('🔎 URL gerada:', authUrl);
  res.redirect(authUrl);
});





router.post('/vincular-discord', async (req, res) => {
  const { discord_id, nome_discord } = req.body;

  if (!discord_id || !nome_discord) {
    return res.status(400).json({ erro: 'Dados incompletos' });
  }

  try {
    // Procura um usuário com esse Discord ID
    let usuario = await Usuario.findOne({ discord_id });

    // Se não encontrar, tenta usar a sessão se disponível
    if (!usuario && req.session?.userId) {
      usuario = await Usuario.findById(req.session.userId);
    }

    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    // Salva os dados do Discord
    usuario.discord_id = discord_id;
    usuario.nome_discord = nome_discord;
    await usuario.save();

    return res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao vincular Discord:', err);
    return res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});



export default router;
