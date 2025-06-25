import axios from 'axios';
import Canal from './models/Canal.js';
import dotenv from 'dotenv';
dotenv.config();


export async function getValidTwitchToken() {
  const canal = await Canal.findOne({ twitch_id: process.env.OWNER_TWITCH_ID });

  if (!canal || !canal.access_token) {
    throw new Error('❌ Nenhum access_token válido encontrado no banco!');
  }

  // Opcional: checar validade
  const now = new Date();
  if (canal.expires_at && canal.expires_at < now) {
    console.warn('⚠️ Token expirado detectado. Considere renovar antes.');
  }

  return canal.access_token;
}




export async function renovarTokenTwitch() {
  const canal = await Canal.findOne({ twitch_id: process.env.OWNER_TWITCH_ID });
  if (!canal || !canal.refresh_token) {
    console.warn('⚠️ Nenhum refresh_token encontrado para renovar');
    return;
  }

  try {
    const res = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        grant_type: 'refresh_token',
        refresh_token: canal.refresh_token,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET
      }
    });

    const { access_token, refresh_token, expires_in } = res.data;

    canal.access_token = access_token;
    canal.refresh_token = refresh_token || canal.refresh_token;
    canal.expires_at = new Date(Date.now() + expires_in * 1000);
    await canal.save();

    console.log('♻️ Token da Twitch renovado com sucesso!');
  } catch (err) {
    console.error('❌ Erro ao renovar token da Twitch:', err.response?.data || err.message);
  }
}


