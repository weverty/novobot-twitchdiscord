// twitch.js
import axios from 'axios';
import dotenv from 'dotenv';
import Canal from './models/Canal.js'; // ← importa seu model do Mongo

dotenv.config();

export async function getValidTwitchToken() {
  const canal = await Canal.findOne({ twitch_id: process.env.OWNER_TWITCH_ID });

  if (!canal || !canal.access_token || !canal.refresh_token) {
    throw new Error('❌ Token do canal não encontrado no banco.');
  }

  const validate = await axios.get('https://id.twitch.tv/oauth2/validate', {
    headers: {
      Authorization: `OAuth ${canal.access_token}`
    }
  }).catch(() => null);

  // Se o token ainda for válido, pode usar direto
  if (validate && validate.data && validate.data.expires_in > 300) {
    return canal.access_token;
  }

  console.log('🔄 Token expirado ou inválido. Renovando...');

  try {
    const { data } = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        grant_type: 'refresh_token',
        refresh_token: canal.refresh_token,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET
      }
    });

    const { access_token, refresh_token } = data;

    await Canal.findOneAndUpdate(
      { twitch_id: canal.twitch_id },
      {
        access_token,
        refresh_token
      }
    );

    console.log('✅ Token renovado com sucesso.');
    return access_token;

  } catch (err) {
    console.error('❌ Falha ao renovar o token:', err.response?.data || err.message);
    throw new Error('❌ Erro na renovação do token da Twitch.');
  }
}
