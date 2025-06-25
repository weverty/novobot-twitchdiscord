import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

console.log('CLIENT:', process.env.DISCORD_CLIENT_ID);
console.log('GUILD:', process.env.DISCORD_GUILD_ID);
console.log('TOKEN:', process.env.DISCORD_TOKEN);


const commands = [
  new SlashCommandBuilder()
    .setName('vincular')
    .setDescription('Vincula sua conta da Twitch com o bot.'),

  new SlashCommandBuilder()
    .setName('vipstatus')
    .setDescription('Mostra quem está vinculado e se é VIP no servidor.'),

  new SlashCommandBuilder()
    .setName('meutwitch')
    .setDescription('Exibe seu vínculo com a Twitch e se você é VIP no servidor.'),

  new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Responde com pong.')

].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('🔁 Registrando comandos...');

    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
      { body: commands }
    );

    console.log('✅ Comandos registrados com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao registrar comandos:', error);
  }
})();
