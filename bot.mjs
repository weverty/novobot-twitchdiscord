import dotenv from 'dotenv';
dotenv.config();

import connectMongo from './mongo.js';
await connectMongo();

import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder
} from 'discord.js';

import cron from 'node-cron';
import axios from 'axios';
import createDB from './db.js';
import { getValidTwitchToken } from './twitch.js';
import Usuario from './models/Usuario.js'; // ✅ IMPORTANTE
import ItemLoja from './models/ItemLoja.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

let db;



// 🎨 Função para log com embed no canal
async function logNoCanal(titulo, descricao, cor) {
  try {
    const canal = await client.channels.fetch(process.env.DISCORD_LOG_CHANNEL_ID);
    if (!canal || !canal.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle(titulo)
      .setDescription(descricao)
      .setColor(cor)
      .setTimestamp();

    await canal.send({ embeds: [embed] });
  } catch (err) {
    console.error('❌ Erro ao enviar embed de log:', err.message);
  }
}

// 🎁 Dar cargo VIP
async function darCargoVIP(guildId, userId, roleId) {
  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);

    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(roleId);
      console.log(`✅ Cargo VIP atribuído para ${member.user.tag}`);
      await logNoCanal('✅ VIP Atribuído', `👤 <@${member.id}> recebeu o cargo VIP!`, 0x57F287);
    } else {
      console.log(`ℹ️ ${member.user.tag} já tem o cargo VIP.`);
    }
  } catch (error) {
    console.error('❌ Erro ao atribuir cargo VIP:', error.message);
  }
}

// 🚫 Remover cargo VIP
async function removerCargoVIP(guildId, userId, roleId) {
  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      console.log(`🚫 Cargo VIP removido de ${member.user.tag}`);
      await logNoCanal('🚫 VIP Removido', `👤 <@${member.id}> teve o cargo VIP removido.`, 0xED4245);
    } 
  } catch (error) {
    console.error('❌ Erro ao remover cargo VIP:', error.message);
  }
}

client.once('ready', async () => {
  console.log(`🤖 Bot online como ${client.user.tag}`);
  db = await createDB();

  cron.schedule('*/1 * * * *', async () => {

    try {
      const accessToken = await getValidTwitchToken();
      const userInfo = await axios.get('https://api.twitch.tv/helix/users', {
        headers: {
          'Client-ID': process.env.CLIENT_ID,
          'Authorization': `Bearer ${accessToken}`
        }
      });

      const broadcasterId = userInfo.data.data[0].id;
      const vips = await axios.get(
        `https://api.twitch.tv/helix/channels/vips?broadcaster_id=${broadcasterId}`,
        {
          headers: {
            'Client-ID': process.env.CLIENT_ID,
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );

      const vipTwitchIds = vips.data.data.map(vip => vip.user_id);

      await db.read();
      for (const usuario of db.data.usuarios) {
        const ehVip = vipTwitchIds.includes(usuario.twitch_id);

        if (ehVip) {
          await darCargoVIP(
            process.env.DISCORD_GUILD_ID,
            usuario.discord_id,
            process.env.DISCORD_ROLE_ID
          );
        } else {
          await removerCargoVIP(
            process.env.DISCORD_GUILD_ID,
            usuario.discord_id,
            process.env.DISCORD_ROLE_ID
          );
        }
      }
    } catch (err) {
      console.error('❌ Erro na verificação automática:', err.response?.data || err.message);
    }
  });

  console.log('⏱️ Agendador iniciado!');

  // 📌 Registra comandos
  const commands = [
    new SlashCommandBuilder()
      .setName('vincular')
      .setDescription('Vincule sua conta da Twitch ao seu Discord.'),
    new SlashCommandBuilder()
      .setName('vipstatus')
      .setDescription('Mostra quem está vinculado e se é VIP no servidor.'),
    new SlashCommandBuilder()
  .setName('criarloja')
  .setDescription('Cria um item na loja com nome e preço')
  .addStringOption(opt =>
    opt.setName('nome')
       .setDescription('Nome do item')
       .setRequired(true))
  .addIntegerOption(opt =>
    opt.setName('preco')
       .setDescription('Preço em pontos')
       .setRequired(true)),

  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
      { body: commands }
    );
    console.log('✅ Comandos registrados com sucesso!');
  } catch (err) {
    console.error('❌ Erro ao registrar comandos:', err);
  }
});

// 🧠 Resposta aos comandos slash
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

if (interaction.commandName === 'vincular') {
const discordId = interaction.user.id;
const nomeDiscord = interaction.user.globalName || interaction.user.username;

const link = `http://localhost:3000/auth/twitch/login?discord_id=${discordId}&nome_discord=${encodeURIComponent(nomeDiscord)}`;
  console.log('🔗 Link gerado:', link); // 🔍 VERIFIQUE se vem certo

    return interaction.reply({
    content: `🔗 Clique aqui para vincular sua conta da Twitch:\n[👉 Vincular Twitch](${link})`,
    ephemeral: true
  });

  const usuario = await Usuario.findOne({ discord_id: discordId });

  if (usuario?.banido) {
    return interaction.reply({
      content: '🚫 Sua conta está banida e não poderá usar este comando.',
      ephemeral: true
    });
  }

  // Atualiza nome_discord no backend
  try {
    await fetch('http://localhost:3000/vincular-discord', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discord_id: discordId, nome_discord: nomeDiscord })
    });
  } catch (err) {
    console.error('Erro ao enviar nome_discord:', err.message);
  }


  await interaction.reply({
    content: `🔗 Clique aqui para vincular sua conta da Twitch:\n${link}`,
    ephemeral: true
  });
} else if (interaction.commandName === 'vipstatus') {
    await interaction.deferReply({ flags: 64 });

    const usuarios = await Usuario.find();
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);

    let resposta = `📋 **Usuários com VIP ativo:**\n\n`;

    for (const u of usuarios) {
      try {
        const member = await guild.members.fetch(u.discord_id);
        const temCargo = member.roles.cache.has(process.env.DISCORD_ROLE_ID);
        if (temCargo) {
          resposta += `✅ <@${u.discord_id}> — Twitch ID: \`${u.twitch_id}\`\n`;
        }
      } catch (err) {
        resposta += `⚠️ <@${u.discord_id}> — Erro ao buscar membro no servidor\n`;
      }
    }

    if (resposta.trim() === `📋 **Usuários com VIP ativo:**`) {
      resposta += `Nenhum usuário VIP encontrado no momento.`;
    }

    await interaction.editReply({ content: resposta });
  } else if (interaction.commandName === 'meutwitch') {
    await interaction.deferReply({ flags: 64 });

    const usuario = await Usuario.findOne({ discord_id: interaction.user.id });

    if (!usuario) {
      return await interaction.editReply({
        content: '❌ Você ainda **não está vinculado**. Use `/vincular` para conectar sua conta da Twitch.'
      });
    }

    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const member = await guild.members.fetch(interaction.user.id);
    const temVip = member.roles.cache.has(process.env.DISCORD_ROLE_ID);

    const status = temVip
      ? '✅ Você está com **VIP ativo** no servidor!'
      : '⚠️ Sua conta está vinculada, mas **você não possui o cargo VIP** no momento.';

    await interaction.editReply({
      content:
        `🧾 **Status da sua conta:**\n\n` +
        `👤 Discord: <@${interaction.user.id}>\n` +
        `🎮 Twitch ID: \`${usuario.twitch_id}\`\n\n` +
        `${status}`
    });
  } else if (interaction.commandName === 'ping') {
  await interaction.reply('🏓 Pong!');
} else if (interaction.commandName === 'criarloja') {
  const nome = interaction.options.getString('nome');
  const preco = interaction.options.getInteger('preco');

  if (interaction.user.id !== process.env.OWNER_DISCORD_ID) {
    return interaction.reply({ content: '⛔ Apenas o dono pode usar este comando.', ephemeral: true });
  }

  try {
    await ItemLoja.create({ nome: nome.trim(), preco });
    await interaction.reply(`✅ Item **${nome}** criado por ${preco} pontos!`);
  } catch (err) {
    console.error('❌ Erro ao criar item:', err.message);
    await interaction.reply({ content: 'Erro ao criar item na loja.', ephemeral: true });
  }
}
 

});

client.login(process.env.DISCORD_TOKEN);
