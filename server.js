const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

// Game state
const players = new Map();
const monsters = new Map();
const items = new Map();
let nextMonsterId = 1;
let nextItemId = 1;

// Quest templates
const QUESTS = {
  1: { id: 1, name: 'Перше полювання', desc: 'Вбийте 5 слаймів', type: 'kill', target: 'slime', count: 5, reward: { gold: 100, exp: 50 } },
  2: { id: 2, name: 'Збір трав', desc: 'Зберіть 10 зілля', type: 'collect', target: 'herb', count: 10, reward: { gold: 150, exp: 75 } },
  3: { id: 3, name: 'Охоронець лісу', desc: 'Вбийте 3 вовків', type: 'kill', target: 'wolf', count: 3, reward: { gold: 200, exp: 100 } },
  4: { id: 4, name: 'Дослідник', desc: 'Відкрийте 80% карти', type: 'explore', target: 'map', count: 80, reward: { gold: 300, exp: 150 } }
};

// Shop items
const SHOP_ITEMS = {
  1: { id: 1, name: 'Залізний меч', type: 'weapon', damage: 15, price: 150 },
  2: { id: 2, name: 'Сталева броня', type: 'armor', defense: 10, price: 200 },
  3: { id: 3, name: 'Зілля здоров\'я', type: 'potion', healing: 50, price: 30 },
  4: { id: 4, name: 'Зілля мани', type: 'mana_potion', mana: 30, price: 25 },
  5: { id: 5, name: 'Магічний посох', type: 'weapon', damage: 20, magic: 10, price: 300 },
  6: { id: 6, name: 'Шкіряні чоботи', type: 'boots', speed: 1.2, price: 100 }
};

// Monster templates
const MONSTER_TYPES = {
  slime: { name: 'Слайм', hp: 50, damage: 5, exp: 20, gold: 10, speed: 0.5 },
  wolf: { name: 'Вовк', hp: 100, damage: 15, exp: 50, gold: 25, speed: 1.2 },
  goblin: { name: 'Гоблін', hp: 80, damage: 12, exp: 40, gold: 20, speed: 1 },
  orc: { name: 'Орк', hp: 150, damage: 25, exp: 100, gold: 50, speed: 0.8 }
};

// Spawn monsters periodically
function spawnMonster() {
  const types = Object.keys(MONSTER_TYPES);
  const type = types[Math.floor(Math.random() * types.length)];
  const template = MONSTER_TYPES[type];
  
  const monster = {
    id: nextMonsterId++,
    type,
    name: template.name,
    x: Math.random() * 3000,
    y: Math.random() * 3000,
    hp: template.hp,
    maxHp: template.hp,
    damage: template.damage,
    exp: template.exp,
    gold: template.gold,
    speed: template.speed,
    targetPlayerId: null,
    lastAttack: 0
  };
  
  monsters.set(monster.id, monster);
}

// Spawn items (herbs, loot)
function spawnItem(x, y, type = 'herb') {
  const item = {
    id: nextItemId++,
    type,
    x,
    y,
    collected: false
  };
  items.set(item.id, item);
}

// Initialize monsters and items
setInterval(() => {
  if (monsters.size < 50) {
    spawnMonster();
  }
}, 3000);

setInterval(() => {
  if (items.size < 30) {
    spawnItem(Math.random() * 3000, Math.random() * 3000);
  }
}, 5000);

// Game loop
setInterval(() => {
  // Update monsters AI
  monsters.forEach(monster => {
    if (!monster.targetPlayerId) {
      // Find nearest player
      let nearestPlayer = null;
      let nearestDist = Infinity;
      
      players.forEach(player => {
        const dist = Math.hypot(player.x - monster.x, player.y - monster.y);
        if (dist < 300 && dist < nearestDist) {
          nearestDist = dist;
          nearestPlayer = player;
        }
      });
      
      if (nearestPlayer) {
        monster.targetPlayerId = nearestPlayer.id;
      }
    }
    
    // Move towards target
    if (monster.targetPlayerId) {
      const target = players.get(monster.targetPlayerId);
      if (target) {
        const dist = Math.hypot(target.x - monster.x, target.y - monster.y);
        
        if (dist > 400) {
          monster.targetPlayerId = null;
        } else if (dist > 30) {
          const angle = Math.atan2(target.y - monster.y, target.x - monster.x);
          monster.x += Math.cos(angle) * monster.speed;
          monster.y += Math.sin(angle) * monster.speed;
        } else {
          // Attack
          const now = Date.now();
          if (now - monster.lastAttack > 1000) {
            target.hp -= monster.damage;
            monster.lastAttack = now;
            
            if (target.hp <= 0) {
              target.hp = target.maxHp;
              target.x = 500;
              target.y = 500;
              monster.targetPlayerId = null;
            }
            
            broadcast({ type: 'damage', targetId: target.id, damage: monster.damage, hp: target.hp });
          }
        }
      }
    }
  });
}, 50);

// WebSocket connection
wss.on('connection', (ws) => {
  const playerId = Date.now() + Math.random();
  
  const player = {
    id: playerId,
    ws,
    name: `Гравець${Math.floor(Math.random() * 1000)}`,
    x: 500,
    y: 500,
    hp: 100,
    maxHp: 100,
    mana: 50,
    maxMana: 50,
    level: 1,
    exp: 0,
    gold: 100,
    damage: 10,
    defense: 0,
    speed: 2,
    inventory: [],
    equipment: {},
    quests: [],
    activeQuests: [],
    exploredTiles: new Set(),
    kills: {}
  };
  
  players.set(playerId, player);
  
  // Send initial data
  ws.send(JSON.stringify({
    type: 'init',
    playerId,
    player,
    players: Array.from(players.values()).map(p => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      level: p.level,
      hp: p.hp,
      maxHp: p.maxHp
    })),
    monsters: Array.from(monsters.values()),
    items: Array.from(items.values()),
    quests: QUESTS,
    shopItems: SHOP_ITEMS
  }));
  
  // Broadcast new player
  broadcast({
    type: 'playerJoined',
    player: {
      id: player.id,
      name: player.name,
      x: player.x,
      y: player.y,
      level: player.level,
      hp: player.hp,
      maxHp: player.maxHp
    }
  }, playerId);
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'move':
          player.x = data.x;
          player.y = data.y;
          
          // Update explored tiles
          const tileX = Math.floor(data.x / 100);
          const tileY = Math.floor(data.y / 100);
          player.exploredTiles.add(`${tileX},${tileY}`);
          
          broadcast({
            type: 'playerMove',
            id: playerId,
            x: data.x,
            y: data.y
          }, playerId);
          break;
          
        case 'attack':
          const monster = monsters.get(data.monsterId);
          if (monster) {
            const dist = Math.hypot(player.x - monster.x, player.y - monster.y);
            if (dist < 100) {
              monster.hp -= player.damage;
              
              broadcast({
                type: 'monsterDamage',
                monsterId: monster.id,
                damage: player.damage,
                hp: monster.hp
              });
              
              if (monster.hp <= 0) {
                // Player gains exp and gold
                player.exp += monster.exp;
                player.gold += monster.gold;
                
                // Track kills
                player.kills[monster.type] = (player.kills[monster.type] || 0) + 1;
                
                // Check quest progress
                player.activeQuests.forEach(quest => {
                  if (quest.type === 'kill' && quest.target === monster.type) {
                    quest.progress = Math.min(quest.progress + 1, quest.count);
                  }
                });
                
                // Level up check
                const expNeeded = player.level * 100;
                if (player.exp >= expNeeded) {
                  player.level++;
                  player.maxHp += 20;
                  player.hp = player.maxHp;
                  player.maxMana += 10;
                  player.mana = player.maxMana;
                  player.damage += 5;
                  player.exp -= expNeeded;
                  
                  ws.send(JSON.stringify({ type: 'levelUp', level: player.level }));
                }
                
                // Drop loot
                if (Math.random() < 0.3) {
                  spawnItem(monster.x, monster.y, 'loot');
                }
                
                monsters.delete(monster.id);
                broadcast({ type: 'monsterDied', monsterId: monster.id });
                
                ws.send(JSON.stringify({
                  type: 'updatePlayer',
                  player: {
                    exp: player.exp,
                    gold: player.gold,
                    level: player.level,
                    hp: player.hp,
                    maxHp: player.maxHp,
                    activeQuests: player.activeQuests
                  }
                }));
              }
            }
          }
          break;
          
        case 'collectItem':
          const item = items.get(data.itemId);
          if (item && !item.collected) {
            const dist = Math.hypot(player.x - item.x, player.y - item.y);
            if (dist < 50) {
              item.collected = true;
              
              if (item.type === 'herb') {
                player.inventory.push({ type: 'herb', name: 'Зілля' });
                
                // Update collect quests
                player.activeQuests.forEach(quest => {
                  if (quest.type === 'collect' && quest.target === 'herb') {
                    quest.progress = Math.min(quest.progress + 1, quest.count);
                  }
                });
              } else if (item.type === 'loot') {
                player.gold += Math.floor(Math.random() * 20 + 10);
              }
              
              items.delete(item.id);
              broadcast({ type: 'itemCollected', itemId: item.id });
              
              ws.send(JSON.stringify({
                type: 'updatePlayer',
                player: {
                  inventory: player.inventory,
                  gold: player.gold,
                  activeQuests: player.activeQuests
                }
              }));
            }
          }
          break;
          
        case 'acceptQuest':
          const quest = QUESTS[data.questId];
          if (quest && !player.activeQuests.find(q => q.id === quest.id)) {
            player.activeQuests.push({
              ...quest,
              progress: 0
            });
            ws.send(JSON.stringify({ type: 'questAccepted', quest: player.activeQuests[player.activeQuests.length - 1] }));
          }
          break;
          
        case 'completeQuest':
          const questIndex = player.activeQuests.findIndex(q => q.id === data.questId);
          if (questIndex !== -1) {
            const q = player.activeQuests[questIndex];
            if (q.progress >= q.count) {
              player.gold += q.reward.gold;
              player.exp += q.reward.exp;
              player.quests.push(q.id);
              player.activeQuests.splice(questIndex, 1);
              
              ws.send(JSON.stringify({
                type: 'questCompleted',
                reward: q.reward,
                player: {
                  gold: player.gold,
                  exp: player.exp,
                  quests: player.quests,
                  activeQuests: player.activeQuests
                }
              }));
            }
          }
          break;
          
        case 'buyItem':
          const shopItem = SHOP_ITEMS[data.itemId];
          if (shopItem && player.gold >= shopItem.price) {
            player.gold -= shopItem.price;
            player.inventory.push(shopItem);
            
            ws.send(JSON.stringify({
              type: 'itemBought',
              item: shopItem,
              gold: player.gold,
              inventory: player.inventory
            }));
          }
          break;
          
        case 'equipItem':
          const invItem = player.inventory[data.index];
          if (invItem) {
            // Unequip current item of same type
            if (player.equipment[invItem.type]) {
              player.inventory.push(player.equipment[invItem.type]);
            }
            
            player.equipment[invItem.type] = invItem;
            player.inventory.splice(data.index, 1);
            
            // Update stats
            if (invItem.damage) player.damage += invItem.damage;
            if (invItem.defense) player.defense += invItem.defense;
            if (invItem.speed) player.speed *= invItem.speed;
            
            ws.send(JSON.stringify({
              type: 'itemEquipped',
              equipment: player.equipment,
              inventory: player.inventory,
              stats: { damage: player.damage, defense: player.defense, speed: player.speed }
            }));
          }
          break;
          
        case 'usePotion':
          const potion = player.inventory.find(i => i.type === 'potion' || i.type === 'mana_potion');
          if (potion) {
            if (potion.healing) {
              player.hp = Math.min(player.hp + potion.healing, player.maxHp);
            }
            if (potion.mana) {
              player.mana = Math.min(player.mana + potion.mana, player.maxMana);
            }
            
            const index = player.inventory.indexOf(potion);
            player.inventory.splice(index, 1);
            
            ws.send(JSON.stringify({
              type: 'potionUsed',
              hp: player.hp,
              mana: player.mana,
              inventory: player.inventory
            }));
          }
          break;
      }
    } catch (err) {
      console.error('Error handling message:', err);
    }
  });
  
  ws.on('close', () => {
    players.delete(playerId);
    broadcast({ type: 'playerLeft', id: playerId });
  });
});

function broadcast(data, excludeId = null) {
  const message = JSON.stringify(data);
  players.forEach((player, id) => {
    if (id !== excludeId && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(message);
    }
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
