import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import Canal from './models/Canal.js';
import Usuario from './models/Usuario.js'; // ✅ Adicionado aqui!

dotenv.config();

async function verificarToken() {
  try {
    // 🔌 Conecta ao Mongo
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Conectado ao Mongo');

    // 🔍 Busca o token salvo do dono do canal
    const canal = await Canal.findOne({ twitch_id: process.env.OWNER_TWITCH_ID });

    if (!canal) {
      console.error('❌ Token não encontrado no banco');
      return;
    }

    const access_token = canal.access_token;

    // 🧪 Faz requisição para validar o token na Twitch
    const response = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: {
        'Authorization': `OAuth ${access_token}`
      }
    });

    const data = await response.json();

    if (data.status === 401 || data.error) {
      console.error('❌ Token inválido:', data);
    } else {
      console.log('✅ Token válido com a Twitch!');
      console.log('login:', data.login);
      console.log('escopos (via Twitch):', data.scope);
      console.log('client_id:', data.client_id);
    }

    // 🔎 Busca os escopos salvos no banco
    const usuario = await Usuario.findOne({ nome_twitch: 'weverty__17' });

    if (usuario) {
      console.log('📦 Escopos salvos no Mongo:', usuario.escopos);
    } else {
      console.log('⚠️ Usuário não encontrado no Mongo.');
    }

    mongoose.disconnect();
  } catch (err) {
    console.error('❌ Erro:', err.message);
    mongoose.disconnect();
  }
}

verificarToken();
