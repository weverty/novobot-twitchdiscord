import axios from 'axios';
import mongoose from 'mongoose';
import 'dotenv/config.js';
import Usuario from './models/Usuario.js'; // ajuste o caminho se necessário
import Canal from './models/Canal.js';

async function atualizarPontos() {
  await mongoose.connect(process.env.MONGO_URI);
  
  const canal = await Canal.findOne({ twitch_id: process.env.OWNER_TWITCH_ID });
  if (!canal?.access_token) {
    console.log('❌ Sem token válido.');
    return;
  }

  try {
    const res = await axios.get('https://api.twitch.tv/helix/streams', {
      params: { user_id: process.env.OWNER_TWITCH_ID },
      headers: {
        'Authorization': `Bearer ${canal.access_token}`,
        'Client-ID': process.env.CLIENT_ID
      }
    });

    const aoVivo = res.data.data.length > 0;

    if (aoVivo) {
      console.log('📡 Live está online. Atualizando pontos...');
      const usuarios = await Usuario.find();

      for (const u of usuarios) {
        u.tempo_assistido += 10; // 10 minutos
        u.pontos += 5; // ganha 5 pontos
        u.ultimo_checkin = new Date();
        await u.save();
      }

      console.log(`✅ Atualizado ${usuarios.length} usuários`);
    } else {
      console.log('🔕 Live offline. Nenhuma pontuação gerada.');
    }
  } catch (err) {
    console.error('❌ Erro ao consultar status da live:', err.message);
  }

  mongoose.disconnect();
}

atualizarPontos();
