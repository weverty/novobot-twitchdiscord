import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Usuario from './models/Usuario.js';

dotenv.config();

await mongoose.connect(process.env.MONGO_URI);
console.log('🔌 Conectado ao MongoDB');

const novoUsuario = new Usuario({
  discord_id: '123456789012345678',
  twitch_id: '987654321'
});

await novoUsuario.save();
console.log('✅ Usuário salvo com sucesso!');
process.exit();
