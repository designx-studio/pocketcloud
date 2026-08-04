import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const API_URL = 'http://localhost:8080';

async function testValidation() {
  // 1. Register a test user
  console.log('Registering user...');
  const userRes = await fetch(`${API_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `test-${Date.now()}@example.com`,
      password: 'password123'
    })
  });
  
  if (!userRes.ok) {
    const errorText = await userRes.text();
    throw new Error(`Register failed: ${userRes.status} - ${errorText}`);
  }
  
  const userData = await userRes.json();
  const token = userData.accessToken;
  console.log('Registered! Token:', token);

  // 2. Register a server node
  console.log('Registering server node...');
  const serverRes = await fetch(`${API_URL}/api/v1/servers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      name: 'test-node',
      provider: 'DigitalOcean',
      ipAddress: '192.168.1.10',
      os: 'Ubuntu 24.04'
    })
  });
  
  if (!serverRes.ok) {
    const errorText = await serverRes.text();
    throw new Error(`Server registration failed: ${serverRes.status} - ${errorText}`);
  }
  
  const serverData = await serverRes.json();
  const serverId = serverData.server.id;
  console.log('Registered server. ID:', serverId);

  // 3. Dispatch an exec task
  console.log('Dispatching exec task...');
  const taskRes = await fetch(`${API_URL}/api/v1/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      serverId: serverId,
      type: 'exec',
      payload: {
        command: 'uptime'
      }
    })
  });

  console.log('Task response status:', taskRes.status);
  const taskBody = await taskRes.json();
  console.log('Task response body:', JSON.stringify(taskBody, null, 2));
}

testValidation().catch(console.error);
