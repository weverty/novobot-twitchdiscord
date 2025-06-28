import Usuario from './models/Usuario.js'; // ajuste o caminho se estiver diferente
import dotenv from 'dotenv';
dotenv.config();

export const protegerPainelTwitch = async (req, res, next) => {
  if (!req.session.userId) return res.redirect('/');

  const usuario = await Usuario.findById(req.session.userId);
  if (!usuario || usuario.twitch_id !== process.env.OWNER_TWITCH_ID) {
    return res.status(403).send('⛔ Acesso restrito: apenas o owner pode entrar no painel.');
  }

  next();
};
