import axios from 'axios';
import createDB from './db.js';

import dotenv from 'dotenv';
dotenv.config();

export async function getValidTwitchToken() {
  const db = await createDB();
  await db.read();

  const auth = db.data.channel_auth;

  if (!auth || !auth.access_token) {
    throw new Error('❌ Nenhum token da Twitch salvo para o canal.');
  }

  const now = Date.now();
  if (auth.expires_at > now) {
    return auth.access_token;
  }

  console.log('🔄 Token expirado. Renovando...');

  const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
    params: {
      grant_type: 'refresh_token',
      refresh_token: auth.refresh_token,
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET
    }
  });

  const { access_token, refresh_token, expires_in } = response.data;

  db.data.channel_auth = {
    access_token,
    refresh_token,
    expires_at: Date.now() + expires_in * 1000
  };

  await db.write();

  console.log('✅ Token renovado com sucesso.');
  return access_token;
}
