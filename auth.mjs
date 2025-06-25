import mongoose from 'mongoose';
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import Usuario from './models/Usuario.js';
import Canal from './models/Canal.js';
import auth from 'basic-auth';
import { EmbedBuilder } from 'discord.js'; // ⬅️ no topo do arquivo (caso ainda não tenha)
import Resgate from './models/Resgate.js';
dotenv.config();
const router = express.Router();




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

  if (!discord_id) {
    return res.status(400).send('❌ Discord ID ausente na URL.');
  }

  const redirectUri = 'http://localhost:3000/auth/twitch/callback';
  const clientId = process.env.CLIENT_ID;
  const scope = 'user:read:email channel:read:vips channel:manage:vips';

  const authUrl = `https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${discord_id}`;
  console.log('🔎 URL gerada:', authUrl);
  res.redirect(authUrl);
});

router.get('/auth/twitch/callback', async (req, res) => {
  const { code, state: discordId } = req.query;

  if (!code) {
    return res.status(400).send('❌ Código ausente.');
  }

  const redirectUri = 'http://localhost:3000/auth/twitch/callback';

  try {
    // 🎟️ Troca o código por token
    const tokenRes = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      }
    });

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    // 👤 Pega dados da conta da Twitch
    const userRes = await axios.get('https://api.twitch.tv/helix/users', {
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Client-ID': process.env.CLIENT_ID
      }
    });

    const twitchUser = userRes.data.data[0];
    const twitchId = twitchUser.id;

    // 🚫 Verifica se está banido
    const banido = await Usuario.findOne({ twitch_id: twitchId, banido: true });
    if (banido) {
      return res.status(403).render('banido', { nome: twitchUser.display_name });
    }

    // 🔗 Cria vínculo se vier Discord ID
    if (discordId) {
      const jaExiste = await Usuario.findOne({
        $or: [
          { discord_id: discordId },
          { twitch_id: twitchId }
        ]
      });

      if (!jaExiste) {
        const novoUsuario = new Usuario({
          discord_id: discordId,
          twitch_id: twitchId,
          nome_twitch: twitchUser.display_name
        });
        await novoUsuario.save();
        console.log('✅ Novo vínculo salvo no MongoDB');
      } else {
        console.log('ℹ️ Vínculo já existia no MongoDB');
        await Usuario.findOneAndUpdate(
          { twitch_id: twitchId },
          { nome_twitch: twitchUser.display_name }
        );
      }
    }

    // 📦 Salva token se for o dono do canal
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
      console.log('📦 Token do canal salvo no Mongo com sucesso!');
    }

    res.send(`✅ Vinculado com sucesso como ${twitchUser.display_name}`);
  } catch (err) {
    console.error('❌ Erro ao vincular:', err.response?.data || err.message);
    res.status(500).send('Erro ao vincular Twitch e Discord.');
  }
});



// 🌐 Painel protegido com botão de remover
router.get('/painel', protegerPainel, async (req, res) => {
  const usuarios = await Usuario.find();
  const guild = await req.app.get('discordClient').guilds.fetch(process.env.DISCORD_GUILD_ID);

  const mensagem = req.query.removido
    ? `<div style="background: #d4edda; color: #155724; padding: 12px; border-radius: 4px; margin-bottom: 16px;">
         ✅ Usuário removido com sucesso!
       </div>`
    : '';

  let html = `
    <style>
      body { font-family: sans-serif; padding: 2rem; background: #f9f9f9; }
      table { width: 100%; border-collapse: collapse; background: #fff; box-shadow: 0 0 10px #ddd; }
      th, td { padding: 10px 14px; border-bottom: 1px solid #eee; }
      th { background: #f0f0f0; text-align: left; }
      tr.vip td { background-color: #e0ffe0; }
    </style>
    ${mensagem}
    <h2>👥 Usuários vinculados</h2>
    <table>
      <tr>
        <th>🎮 Twitch</th>
        <th>🆔 Discord</th>
        <th>Twitch ID</th>
        <th>VIP?</th>
        <th>Ações</th>
      </tr>
  `;

  for (const u of usuarios) {
    try {
      const member = await guild.members.fetch(u.discord_id);
      const temVip = member.roles.cache.has(process.env.DISCORD_ROLE_ID);
      html += `<tr class="${temVip ? 'vip' : ''}">
        <td>${u.nome_twitch || '<i>Desconhecido</i>'}</td>
        <td><a href="https://discord.com/users/${u.discord_id}" target="_blank">${u.discord_id}</a></td>
        <td>${u.twitch_id}</td>
        <td>${temVip ? '✅ Sim' : '❌ Não'}</td>
        <td>
          ${
  u.banido
    ? `<span style="color: gray;" title="Usuário banido – não pode remover">🔒 Bloqueado</span>`
    : `${
  u.banido
    ? `<span style="color: gray;" title="Usuário banido – não pode ser removido">🔒 Banido</span>`
    : `<a href="/remover/${u.discord_id}" onclick="return confirm('Tem certeza que deseja remover este vínculo?')">🗑️ Remover</a>`
}
`
}
          &nbsp;|&nbsp;
          ${
            u.banido
              ? `<form method="POST" action="/desbanir/${u._id}" style="display:inline;">
                   <button onclick="return confirm('Desbanir este usuário?')" style="background: #28a745; color: white; border: none; padding: 4px 10px; border-radius: 4px;">Desbanir</button>
                 </form>`
              : `<form method="POST" action="/banir/${u._id}" style="display:inline;">
                   <button onclick="return confirm('Banir este usuário?')" style="background: crimson; color: white; border: none; padding: 4px 10px; border-radius: 4px;">Banir</button>
                 </form>`
          }
        </td>
      </tr>`;
    } catch (e) {
      html += `<tr><td colspan="5">⚠️ Erro ao buscar membro ${u.discord_id}</td></tr>`;
    }
  }

  html += `</table>`;
  res.send(html);
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



router.post('/banir/:id', protegerPainel, async (req, res) => {
  try {
    const userId = req.params.id;
    const usuario = await Usuario.findByIdAndUpdate(userId, { banido: true }, { new: true });

    const canal = await Canal.findOne({ twitch_id: process.env.OWNER_TWITCH_ID });
    const token = canal?.access_token;

    let nomeTwitch = 'Não encontrado';

    if (token && usuario.twitch_id) {
      try {
        const resTwitch = await axios.get('https://api.twitch.tv/helix/users', {
          params: { id: usuario.twitch_id },
          headers: {
            'Authorization': `Bearer ${token}`,
            'Client-ID': process.env.CLIENT_ID
          }
        });

        nomeTwitch = resTwitch.data.data[0]?.display_name || 'Desconhecido';
      } catch (err) {
        console.warn('⚠️ Erro ao buscar nome da Twitch:', err.message);
      }
    }

    const guild = await req.app.get('discordClient').guilds.fetch(process.env.DISCORD_GUILD_ID);
    const membro = await guild.members.fetch(usuario.discord_id).catch(() => null);

    const nomeDiscord = membro?.user?.tag || 'Não encontrado';

    const canalLog = await req.app.get('discordClient').channels.fetch(process.env.DISCORD_LOG_CHANNEL_ID);
    if (canalLog?.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle('🚫 Usuário Banido pelo Painel')
        .setColor(0xff0000)
        .addFields(
          { name: '📌 Discord', value: `\`${usuario.discord_id}\` (${nomeDiscord})`, inline: false },
          { name: '🎮 Twitch', value: `\`${usuario.twitch_id}\` (${nomeTwitch})`, inline: false },
          { name: '📝 Motivo', value: 'Banido pelo site', inline: false }
        )
        .setTimestamp();

      await canalLog.send({ embeds: [embed] });
    }

    res.redirect('/painel');
  } catch (err) {
    console.error('Erro ao banir usuário:', err);
    res.status(500).send('Erro ao banir usuário.');
  }
});



router.post('/desbanir/:id', protegerPainel, async (req, res) => {
  try {
    const userId = req.params.id;
    const usuario = await Usuario.findByIdAndUpdate(userId, { banido: false }, { new: true });

    const canal = await Canal.findOne({ twitch_id: process.env.OWNER_TWITCH_ID });
    const token = canal?.access_token;

    let nomeTwitch = userId;

    if (token && usuario.twitch_id) {
      try {
        const resTwitch = await axios.get('https://api.twitch.tv/helix/users', {
          params: { id: usuario.twitch_id },
          headers: {
            'Authorization': `Bearer ${token}`,
            'Client-ID': process.env.CLIENT_ID
          }
        });

        nomeTwitch = resTwitch.data.data[0]?.display_name || 'Desconhecido';
      } catch (err) {
        console.warn('⚠️ Erro ao buscar nome da Twitch:', err.message);
      }
    }

    const guild = await req.app.get('discordClient').guilds.fetch(process.env.DISCORD_GUILD_ID);
    const membro = await guild.members.fetch(usuario.discord_id).catch(() => null);
    const nomeDiscord = membro?.user?.tag || 'Não encontrado';

    const canalLog = await req.app.get('discordClient').channels.fetch(process.env.DISCORD_LOG_CHANNEL_ID);
    if (canalLog?.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle('✅ Usuário Desbanido pelo Painel')
        .setColor(0x28a745)
        .addFields(
          { name: '📌 Discord', value: `\`${usuario.discord_id}\` (${nomeDiscord})`, inline: false },
          { name: '🎮 Twitch', value: `\`${usuario.twitch_id}\` (${nomeTwitch})`, inline: false },
          { name: '📝 Motivo', value: 'Desbanido pelo site', inline: false }
        )
        .setTimestamp();

      await canalLog.send({ embeds: [embed] });
    }

    res.redirect('/painel');
  } catch (err) {
    console.error('Erro ao desbanir usuário:', err);
    res.status(500).send('Erro ao desbanir usuário.');
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

router.get('/loja', async (req, res) => {
  const itens = [
    { nome: '🎵 Tocar música na live', preco: 100 },
    { nome: '🗣️ Mensagem destacada no bot', preco: 50 },
    { nome: '🎉 Entrar no sorteio do mês', preco: 200 },
    { nome: '👑 Cargo VIP no Discord (24h)', preco: 300 }
  ];

  let html = `
    <style>
      body { font-family: sans-serif; background: #111; color: #fff; padding: 2rem; }
      h1 { color: #1ea1f2; }
      .item { background: #222; padding: 1rem; margin: 1rem 0; border-radius: 8px; }
      .item h2 { margin: 0; font-size: 1.2em; }
      .item form { margin-top: 10px; }
      .item button { background: #1ea1f2; border: none; color: white; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
    </style>

    <h1>🛒 Loja de Recompensas</h1>
    <p>Bem-vindo, Weverty! Escolha um item para resgatar.</p>
  `;

  const twitchIdTeste = '170721291'; // seu ID confirmado

  for (const item of itens) {
    html += `
      <div class="item">
        <h2>${item.nome}</h2>
        <p>💰 Custa: <strong>${item.preco}</strong> pontos</p>
        <form method="POST" action="/resgatar">
          <input type="hidden" name="twitch_id" value="${twitchIdTeste}">
          <input type="hidden" name="item" value="${item.nome}">
          <input type="hidden" name="preco" value="${item.preco}">
          <button type="submit">Resgatar</button>
        </form>
      </div>
    `;
  }

  res.send(html);
});


router.post('/resgatar', async (req, res) => {
  const { twitch_id, item, preco } = req.body;

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



export default router;
