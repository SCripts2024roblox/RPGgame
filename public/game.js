const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');
const minimap = document.getElementById('minimap');
const minimapCtx = minimap.getContext('2d');

// Set canvas size
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Game state
let ws;
let playerId;
let localPlayer = null;
let players = new Map();
let monsters = new Map();
let items = new Map();
let quests = {};
let shopItems = {};
let camera = { x: 0, y: 0 };
let keys = {};
let mousePos = { x: 0, y: 0 };
let worldSize = 3000;

// Fog of war
let exploredTiles = new Set();

// Connect to server
function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  ws = new WebSocket(`${protocol}//${host}`);
  
  ws.onopen = () => {
    console.log('Connected to server');
  };
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleServerMessage(data);
  };
  
  ws.onclose = () => {
    console.log('Disconnected from server');
    setTimeout(connect, 3000);
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

function handleServerMessage(data) {
  switch (data.type) {
    case 'init':
      playerId = data.playerId;
      localPlayer = data.player;
      exploredTiles = new Set(data.player.exploredTiles || []);
      
      data.players.forEach(p => {
        players.set(p.id, p);
      });
      
      data.monsters.forEach(m => {
        monsters.set(m.id, m);
      });
      
      data.items.forEach(i => {
        items.set(i.id, i);
      });
      
      quests = data.quests;
      shopItems = data.shopItems;
      
      updateHUD();
      renderShop();
      renderAllQuests();
      break;
      
    case 'playerJoined':
      players.set(data.player.id, data.player);
      break;
      
    case 'playerLeft':
      players.delete(data.id);
      break;
      
    case 'playerMove':
      const player = players.get(data.id);
      if (player) {
        player.x = data.x;
        player.y = data.y;
      }
      break;
      
    case 'monsterDamage':
      const monster = monsters.get(data.monsterId);
      if (monster) {
        monster.hp = data.hp;
        showDamageNumber(monster.x, monster.y, data.damage, '#ff4444');
      }
      break;
      
    case 'monsterDied':
      monsters.delete(data.monsterId);
      break;
      
    case 'damage':
      if (data.targetId === playerId) {
        localPlayer.hp = data.hp;
        updateHUD();
        showDamageNumber(localPlayer.x, localPlayer.y, data.damage, '#ff0000');
      }
      break;
      
    case 'itemCollected':
      items.delete(data.itemId);
      break;
      
    case 'updatePlayer':
      Object.assign(localPlayer, data.player);
      updateHUD();
      renderActiveQuests();
      renderInventory();
      break;
      
    case 'levelUp':
      showNotification(`🎉 РІВЕНЬ ${data.level}! 🎉`);
      localPlayer.level = data.level;
      updateHUD();
      break;
      
    case 'questAccepted':
      showNotification(`✅ Квест прийнято: ${data.quest.name}`);
      renderActiveQuests();
      break;
      
    case 'questCompleted':
      showNotification(`🏆 Квест виконано! +${data.reward.gold} золота, +${data.reward.exp} досвіду`);
      renderActiveQuests();
      break;
      
    case 'itemBought':
      showNotification(`🛒 Куплено: ${data.item.name}`);
      localPlayer.gold = data.gold;
      localPlayer.inventory = data.inventory;
      updateHUD();
      renderInventory();
      break;
      
    case 'itemEquipped':
      showNotification(`⚔️ Екіпіровано: ${data.equipment[Object.keys(data.equipment)[Object.keys(data.equipment).length - 1]].name}`);
      localPlayer.equipment = data.equipment;
      localPlayer.inventory = data.inventory;
      updateStats(data.stats);
      renderInventory();
      break;
      
    case 'potionUsed':
      showNotification('🧪 Зілля використано!');
      localPlayer.hp = data.hp;
      localPlayer.mana = data.mana;
      localPlayer.inventory = data.inventory;
      updateHUD();
      renderInventory();
      break;
  }
}

// Input handling
window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
});

window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
});

canvas.addEventListener('mousemove', (e) => {
  mousePos.x = e.clientX;
  mousePos.y = e.clientY;
});

canvas.addEventListener('click', (e) => {
  if (!localPlayer) return;
  
  const worldX = e.clientX + camera.x;
  const worldY = e.clientY + camera.y;
  
  // Check monster click
  monsters.forEach(monster => {
    const dx = worldX - monster.x;
    const dy = worldY - monster.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < 30) {
      ws.send(JSON.stringify({
        type: 'attack',
        monsterId: monster.id
      }));
    }
  });
  
  // Check item click
  items.forEach(item => {
    const dx = worldX - item.x;
    const dy = worldY - item.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < 20) {
      ws.send(JSON.stringify({
        type: 'collectItem',
        itemId: item.id
      }));
    }
  });
});

// Game loop
let lastMove = 0;
function gameLoop() {
  if (!localPlayer) {
    requestAnimationFrame(gameLoop);
    return;
  }
  
  // Movement
  let moved = false;
  const speed = localPlayer.speed || 2;
  
  if (keys['w'] || keys['arrowup']) {
    localPlayer.y -= speed;
    moved = true;
  }
  if (keys['s'] || keys['arrowdown']) {
    localPlayer.y += speed;
    moved = true;
  }
  if (keys['a'] || keys['arrowleft']) {
    localPlayer.x -= speed;
    moved = true;
  }
  if (keys['d'] || keys['arrowright']) {
    localPlayer.x += speed;
    moved = true;
  }
  
  // Bounds check
  localPlayer.x = Math.max(0, Math.min(worldSize, localPlayer.x));
  localPlayer.y = Math.max(0, Math.min(worldSize, localPlayer.y));
  
  // Send position update
  if (moved && Date.now() - lastMove > 50) {
    lastMove = Date.now();
    ws.send(JSON.stringify({
      type: 'move',
      x: localPlayer.x,
      y: localPlayer.y
    }));
    
    // Update explored tiles
    const tileX = Math.floor(localPlayer.x / 100);
    const tileY = Math.floor(localPlayer.y / 100);
    exploredTiles.add(`${tileX},${tileY}`);
  }
  
  // Camera follow player
  camera.x = localPlayer.x - canvas.width / 2;
  camera.y = localPlayer.y - canvas.height / 2;
  camera.x = Math.max(0, Math.min(worldSize - canvas.width, camera.x));
  camera.y = Math.max(0, Math.min(worldSize - canvas.height, camera.y));
  
  // Render
  render();
  renderMinimap();
  
  requestAnimationFrame(gameLoop);
}

// Damage numbers
let damageNumbers = [];
function showDamageNumber(x, y, damage, color) {
  damageNumbers.push({
    x, y,
    damage,
    color,
    alpha: 1,
    vy: -2
  });
}

function updateDamageNumbers() {
  damageNumbers = damageNumbers.filter(dn => {
    dn.y += dn.vy;
    dn.alpha -= 0.02;
    return dn.alpha > 0;
  });
}

// Rendering
function render() {
  ctx.fillStyle = '#2d4a2b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Grid
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
  ctx.lineWidth = 1;
  
  const startX = Math.floor(camera.x / 100) * 100;
  const startY = Math.floor(camera.y / 100) * 100;
  
  for (let x = startX; x < camera.x + canvas.width; x += 100) {
    ctx.beginPath();
    ctx.moveTo(x - camera.x, 0);
    ctx.lineTo(x - camera.x, canvas.height);
    ctx.stroke();
  }
  
  for (let y = startY; y < camera.y + canvas.height; y += 100) {
    ctx.beginPath();
    ctx.moveTo(0, y - camera.y);
    ctx.lineTo(canvas.width, y - camera.y);
    ctx.stroke();
  }
  
  // Fog of war
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  for (let tx = 0; tx < worldSize / 100; tx++) {
    for (let ty = 0; ty < worldSize / 100; ty++) {
      if (!exploredTiles.has(`${tx},${ty}`)) {
        ctx.fillRect(
          tx * 100 - camera.x,
          ty * 100 - camera.y,
          100,
          100
        );
      }
    }
  }
  
  // Items
  items.forEach(item => {
    const screenX = item.x - camera.x;
    const screenY = item.y - camera.y;
    
    if (item.type === 'herb') {
      ctx.fillStyle = '#44ff44';
      ctx.beginPath();
      ctx.arc(screenX, screenY, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '12px Arial';
      ctx.fillText('🌿', screenX - 6, screenY + 4);
    } else if (item.type === 'loot') {
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.arc(screenX, screenY, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.font = 'bold 14px Arial';
      ctx.fillText('💰', screenX - 7, screenY + 5);
    }
  });
  
  // Monsters
  monsters.forEach(monster => {
    const screenX = monster.x - camera.x;
    const screenY = monster.y - camera.y;
    
    // Monster body
    let color = '#ff4444';
    if (monster.type === 'slime') color = '#44ff44';
    if (monster.type === 'wolf') color = '#888888';
    if (monster.type === 'goblin') color = '#88ff44';
    if (monster.type === 'orc') color = '#ff8844';
    
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(screenX, screenY, 20, 0, Math.PI * 2);
    ctx.fill();
    
    // Eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(screenX - 7, screenY - 5, 4, 0, Math.PI * 2);
    ctx.arc(screenX + 7, screenY - 5, 4, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(screenX - 7, screenY - 5, 2, 0, Math.PI * 2);
    ctx.arc(screenX + 7, screenY - 5, 2, 0, Math.PI * 2);
    ctx.fill();
    
    // HP bar
    const hpPercent = monster.hp / monster.maxHp;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(screenX - 25, screenY - 35, 50, 6);
    ctx.fillStyle = hpPercent > 0.5 ? '#44ff44' : hpPercent > 0.25 ? '#ffff44' : '#ff4444';
    ctx.fillRect(screenX - 25, screenY - 35, 50 * hpPercent, 6);
    
    // Name
    ctx.fillStyle = '#fff';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(monster.name, screenX, screenY - 40);
    ctx.textAlign = 'left';
  });
  
  // Other players
  players.forEach((player, id) => {
    if (id === playerId) return;
    
    const screenX = player.x - camera.x;
    const screenY = player.y - camera.y;
    
    // Player body
    ctx.fillStyle = '#4a90e2';
    ctx.beginPath();
    ctx.arc(screenX, screenY, 15, 0, Math.PI * 2);
    ctx.fill();
    
    // Eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(screenX - 5, screenY - 3, 3, 0, Math.PI * 2);
    ctx.arc(screenX + 5, screenY - 3, 3, 0, Math.PI * 2);
    ctx.fill();
    
    // Name
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(player.name, screenX, screenY - 25);
    ctx.fillText(`Lvl ${player.level}`, screenX, screenY - 35);
    ctx.textAlign = 'left';
  });
  
  // Local player
  if (localPlayer) {
    const screenX = localPlayer.x - camera.x;
    const screenY = localPlayer.y - camera.y;
    
    // Player body with glow
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 15;
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.arc(screenX, screenY, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    
    // Eyes
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(screenX - 5, screenY - 3, 3, 0, Math.PI * 2);
    ctx.arc(screenX + 5, screenY - 3, 3, 0, Math.PI * 2);
    ctx.fill();
    
    // Name
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(localPlayer.name, screenX, screenY - 25);
    ctx.fillText(`Lvl ${localPlayer.level}`, screenX, screenY - 35);
    ctx.textAlign = 'left';
  }
  
  // Damage numbers
  updateDamageNumbers();
  damageNumbers.forEach(dn => {
    const screenX = dn.x - camera.x;
    const screenY = dn.y - camera.y;
    
    ctx.save();
    ctx.globalAlpha = dn.alpha;
    ctx.fillStyle = dn.color;
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`-${dn.damage}`, screenX, screenY);
    ctx.restore();
  });
}

function renderMinimap() {
  minimapCtx.fillStyle = '#000';
  minimapCtx.fillRect(0, 0, 200, 200);
  
  const scale = 200 / worldSize;
  
  // Explored areas
  minimapCtx.fillStyle = 'rgba(50, 100, 50, 0.5)';
  exploredTiles.forEach(tile => {
    const [tx, ty] = tile.split(',').map(Number);
    minimapCtx.fillRect(tx * 100 * scale, ty * 100 * scale, 100 * scale, 100 * scale);
  });
  
  // Monsters
  minimapCtx.fillStyle = '#ff4444';
  monsters.forEach(monster => {
    minimapCtx.fillRect(
      monster.x * scale - 2,
      monster.y * scale - 2,
      4, 4
    );
  });
  
  // Other players
  minimapCtx.fillStyle = '#4a90e2';
  players.forEach((player, id) => {
    if (id === playerId) return;
    minimapCtx.fillRect(
      player.x * scale - 2,
      player.y * scale - 2,
      4, 4
    );
  });
  
  // Local player
  if (localPlayer) {
    minimapCtx.fillStyle = '#ffd700';
    minimapCtx.fillRect(
      localPlayer.x * scale - 3,
      localPlayer.y * scale - 3,
      6, 6
    );
  }
}

// UI Functions
function updateHUD() {
  if (!localPlayer) return;
  
  document.getElementById('playerName').textContent = localPlayer.name;
  document.getElementById('playerLevel').textContent = localPlayer.level;
  document.getElementById('goldAmount').textContent = localPlayer.gold;
  
  const hpPercent = (localPlayer.hp / localPlayer.maxHp) * 100;
  document.getElementById('hpBar').style.width = hpPercent + '%';
  document.getElementById('hpText').textContent = `${Math.floor(localPlayer.hp)} / ${localPlayer.maxHp}`;
  
  const manaPercent = (localPlayer.mana / localPlayer.maxMana) * 100;
  document.getElementById('manaBar').style.width = manaPercent + '%';
  document.getElementById('manaText').textContent = `${Math.floor(localPlayer.mana)} / ${localPlayer.maxMana}`;
  
  const expNeeded = localPlayer.level * 100;
  const expPercent = (localPlayer.exp / expNeeded) * 100;
  document.getElementById('expBar').style.width = expPercent + '%';
  document.getElementById('expText').textContent = `${Math.floor(localPlayer.exp)} / ${expNeeded}`;
}

function renderActiveQuests() {
  if (!localPlayer) return;
  
  const questList = document.getElementById('questList');
  questList.innerHTML = '';
  
  if (localPlayer.activeQuests && localPlayer.activeQuests.length > 0) {
    localPlayer.activeQuests.forEach(quest => {
      const questDiv = document.createElement('div');
      questDiv.className = 'quest-item';
      
      const canComplete = quest.progress >= quest.count;
      
      questDiv.innerHTML = `
        <div class="quest-name">${quest.name}</div>
        <div class="quest-desc">${quest.desc}</div>
        <div class="quest-progress">Прогрес: ${quest.progress} / ${quest.count}</div>
        ${canComplete ? `<button class="quest-btn" onclick="completeQuest(${quest.id})">Завершити</button>` : ''}
      `;
      
      questList.appendChild(questDiv);
    });
  } else {
    questList.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">Немає активних квестів</div>';
  }
}

function renderAllQuests() {
  const questsList = document.getElementById('allQuestsList');
  questsList.innerHTML = '';
  
  Object.values(quests).forEach(quest => {
    const isActive = localPlayer.activeQuests?.some(q => q.id === quest.id);
    const isCompleted = localPlayer.quests?.includes(quest.id);
    
    if (!isActive && !isCompleted) {
      const questDiv = document.createElement('div');
      questDiv.className = 'quest-item';
      questDiv.innerHTML = `
        <div class="quest-name">${quest.name}</div>
        <div class="quest-desc">${quest.desc}</div>
        <div style="font-size: 11px; color: #44ff44; margin-top: 8px;">
          Нагорода: ${quest.reward.gold} золота, ${quest.reward.exp} досвіду
        </div>
        <button class="quest-btn" onclick="acceptQuest(${quest.id})">Прийняти</button>
      `;
      questsList.appendChild(questDiv);
    }
  });
}

function renderShop() {
  const shopGrid = document.getElementById('shopGrid');
  shopGrid.innerHTML = '';
  
  Object.values(shopItems).forEach(item => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'shop-item';
    
    let stats = '';
    if (item.damage) stats += `⚔️ Урон: +${item.damage}<br>`;
    if (item.defense) stats += `🛡️ Захист: +${item.defense}<br>`;
    if (item.healing) stats += `❤️ Здоров'я: +${item.healing}<br>`;
    if (item.mana) stats += `✨ Мана: +${item.mana}<br>`;
    if (item.speed) stats += `⚡ Швидкість: x${item.speed}<br>`;
    
    itemDiv.innerHTML = `
      <div class="item-name">${item.name}</div>
      <div class="item-stats">${stats}</div>
      <div class="item-price">💰 ${item.price}</div>
      <button class="buy-btn" onclick="buyItem(${item.id})">Купити</button>
    `;
    
    shopGrid.appendChild(itemDiv);
  });
}

function renderInventory() {
  if (!localPlayer) return;
  
  const inventoryGrid = document.getElementById('inventoryGrid');
  inventoryGrid.innerHTML = '';
  
  for (let i = 0; i < 16; i++) {
    const slot = document.createElement('div');
    slot.className = 'inventory-slot';
    
    if (localPlayer.inventory && localPlayer.inventory[i]) {
      const item = localPlayer.inventory[i];
      slot.classList.add('has-item');
      slot.innerHTML = `<div class="inventory-item-name">${item.name}</div>`;
      slot.onclick = () => equipItem(i);
    }
    
    inventoryGrid.appendChild(slot);
  }
}

function updateStats(stats) {
  document.getElementById('statDamage').textContent = stats.damage;
  document.getElementById('statDefense').textContent = stats.defense;
  document.getElementById('statSpeed').textContent = stats.speed.toFixed(1);
}

function showNotification(text) {
  const notif = document.createElement('div');
  notif.className = 'notification';
  notif.textContent = text;
  document.getElementById('notifications').appendChild(notif);
  
  setTimeout(() => notif.remove(), 2000);
}

// UI Toggles
function toggleShop() {
  document.getElementById('shopModal').classList.toggle('active');
}

function toggleInventory() {
  document.getElementById('inventoryModal').classList.toggle('active');
  renderInventory();
}

function toggleQuests() {
  document.getElementById('allQuestsModal').classList.toggle('active');
  renderAllQuests();
}

// Actions
function acceptQuest(questId) {
  ws.send(JSON.stringify({ type: 'acceptQuest', questId }));
}

function completeQuest(questId) {
  ws.send(JSON.stringify({ type: 'completeQuest', questId }));
}

function buyItem(itemId) {
  ws.send(JSON.stringify({ type: 'buyItem', itemId }));
}

function equipItem(index) {
  ws.send(JSON.stringify({ type: 'equipItem', index }));
}

function usePotion() {
  ws.send(JSON.stringify({ type: 'usePotion' }));
}

// Start
connect();
requestAnimationFrame(gameLoop);
