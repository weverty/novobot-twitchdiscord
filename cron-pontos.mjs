import cron from 'node-cron';
import mongoose from 'mongoose';
import axios from 'axios';
import 'dotenv/config.js';
import Usuario from './models/Usuario.js';
import Canal from './models/Canal.js';

import Sistema from './models/Sistema.js'; // 👉 Coloque no topo do arquivo

async function atualizarPontos() {
  try {
    // ... (código que verifica se está ao vivo)

    if (aoVivo) {
      const usuarios = await Usuario.find();
      for (const u of usuarios) {
        u.tempo_assistido += 10;
        u.pontos += 5;
        u.ultimo_checkin = new Date();
        await u.save();
      }

      // 🧠 AQUI: salva a última execução
      await Sistema.findOneAndUpdate(
        {},
        { ultima_execucao_pontos: new Date() },
        { upsert: true }
      );

      console.log(`✅ Pontos atualizados para ${usuarios.length} usuários.`);
    }

  } catch (err) {
    console.error('❌ Erro ao atualizar pontos:', err.message);
  }
}


// 🔁 Conecta uma vez e agenda as execuções
async function iniciarCron() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('🚀 Cron de Pontos iniciado');

  // A cada 10 minutos
  cron.schedule('*/10 * * * *', async () => {
    console.log('⏱️ Executando rodada de pontos...');
    await atualizarPontos();
  });
}



iniciarCron();
