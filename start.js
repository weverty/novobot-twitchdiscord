import { spawn } from 'child_process';

const bot = spawn('node', ['bot.mjs'], { stdio: 'inherit' });
const server = spawn('node', ['server.js'], { stdio: 'inherit' });
