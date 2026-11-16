import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import crypto from 'crypto';

const app = express(); app.use(cors({origin:true})); app.get('/health',(_,res)=>res.json({ok:true,game:'Trio Online'}));
const httpServer=createServer(app);
const io=new Server(httpServer,{cors:{origin:true,methods:['GET','POST']}});
const rooms=new Map();
const PORT=process.env.PORT||3001;
const code=()=>crypto.randomBytes(3).toString('hex').toUpperCase();
const shuffle=a=>{const x=[...a];for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];}return x;};
function publicState(room,viewer){
 const players=room.players.map((p,i)=>({id:p.id,name:p.name,index:i,team:p.team,handCount:p.hand.length,hand:i===viewer?p.hand.map(c=>({id:c.id,value:c.value})):undefined,sets:room.sets.filter(s=>s.winner===i || (isTeam(room)&&s.team===p.team)).map(s=>s.value),connected:p.connected,swapReady:!!p.swapReady}));
 return {code:room.code,status:room.status,mode:room.mode,players,middle:room.middle.map(c=>({id:c.id,value:c.faceUp?c.value:null,faceUp:c.faceUp})),revealed:room.revealed.map(r=>({value:r.card.value,source:r.source,owner:r.owner,position:r.position})),current:room.current,turn:room.turn,sets:room.sets.map(s=>({value:s.value,winner:s.winner,team:s.team})),winner:room.winner,swapFor:room.swapFor,swapSelections:room.players.map((p,i)=>({index:i,ready:!!p.swapReady,selected:room.status==='swap'&&i===viewer&&p.swapChoice!==null})),lastMessage:room.lastMessage};
}
function emitRoom(room){for(const p of room.players){io.to(p.id).emit('state',publicState(room,room.players.indexOf(p)));}}
function fail(socket,msg){socket.emit('errorMessage',msg);}
function makeDeck(){return shuffle(Array.from({length:36},(_,i)=>({id:`c${i}-${crypto.randomBytes(2).toString('hex')}`,value:Math.floor(i/3)+1})));}
function connected(a,b){return Math.abs(a-b)===7||a+b===7;}
const isTeam=room=>room.mode==='team-simple'||room.mode==='team-spicy';
const isSpicy=room=>room.mode==='spicy'||room.mode==='team-spicy';
function winnerFor(room,playerIndex){
 const team=isTeam(room)?room.players[playerIndex].team:null;
 const wins=room.sets.filter(s=>isTeam(room)?s.team===team:s.winner===playerIndex).map(s=>s.value);
 if(wins.includes(7)) return isTeam(room)?`Team ${team+1}`:room.players[playerIndex].name;
 if(isSpicy(room)){
  for(let i=0;i<wins.length;i++)for(let j=i+1;j<wins.length;j++)if(connected(wins[i],wins[j]))return isTeam(room)?`Team ${team+1}`:room.players[playerIndex].name;
 } else if(wins.length>=3) return isTeam(room)?`Team ${team+1}`:room.players[playerIndex].name;
 return null;
}
function startSwap(room,teamIndexes){room.status='swap';room.swapFor=teamIndexes;room.players.forEach((p,i)=>{p.swapChoice=null;p.swapReady=!teamIndexes.includes(p.team);});room.lastMessage='Teams: secretly choose one card to exchange with your partner. You may skip by confirming without a selection.';}
function finishSwapIfReady(room){
 const eligible=room.players.filter(p=>room.swapFor.includes(p.team));
 if(!eligible.every(p=>p.swapReady))return;
 const n=room.players.length,teamCount=n/2;
 for(let t of room.swapFor){const a=room.players.findIndex(p=>p.team===t),b=a+teamCount;const pa=room.players[a],pb=room.players[b];if(pa.swapChoice!==null&&pb.swapChoice!==null){const ca=pa.hand.splice(pa.swapChoice,1)[0],cb=pb.hand.splice(pb.swapChoice,1)[0];pa.hand.push(cb);pb.hand.push(ca);pa.hand.sort((x,y)=>x.value-y.value);pb.hand.sort((x,y)=>x.value-y.value);}}
 room.players.forEach(p=>{p.swapChoice=null;p.swapReady=false;});room.status='playing';room.lastMessage='Swap complete. Play continues.';}
function startGame(room){
 const n=room.players.length;if(n<3||n>6)throw new Error('Trio needs 3–6 players.');
 if(isTeam(room)&&![4,6].includes(n))throw new Error('Team mode requires exactly 4 or 6 players.');
 const deck=makeDeck();const per=isTeam(room)?36/n:{3:9,4:7,5:6,6:5}[n];
 room.players.forEach((p,i)=>{p.hand=deck.splice(0,per).sort((a,b)=>a.value-b.value);p.team=isTeam(room)?i%(n/2):i;p.swapChoice=null;p.swapReady=false;});
 room.middle=deck.map(c=>({...c,faceUp:false}));room.revealed=[];room.sets=[];room.current=0;room.turn=0;room.winner=null;room.status='playing';room.lastMessage=`Game started. ${room.players[0].name} goes first.`;
 if(isTeam(room))startSwap(room,[...new Set(room.players.map(p=>p.team))]);
}
function nextTurn(room){room.current=(room.current+1)%room.players.length;room.turn++;}
function resetRevealed(room){for(const r of room.revealed){if(r.source==='middle'){const c=room.middle.find(c=>c.id===r.card.id);if(c)c.faceUp=false;}else{const p=room.players[r.owner];p.hand.push(r.card);p.hand.sort((a,b)=>a.value-b.value);}}room.revealed=[];}
function doReveal(room,playerIndex,action){
 if(room.status!=='playing')throw new Error('The game is not accepting moves right now.');
 if(room.current!==playerIndex)throw new Error('It is not your turn.');
 if(room.revealed.length>=3)throw new Error('You have already revealed three cards.');
 let card,source,owner=null,position=null;
 if(action.type==='middle'){
  const c=room.middle.find(c=>c.id===action.cardId);if(!c||c.faceUp)throw new Error('That middle card is not available.');c.faceUp=true;card=c;source='middle';position=room.middle.indexOf(c);
 }else if(action.type==='hand'){
  const target=Number(action.playerIndex);if(!Number.isInteger(target)||!room.players[target])throw new Error('Invalid player.');
  const hand=room.players[target].hand;if(!hand.length)throw new Error('That player has no cards left.');
  if(action.edge!=='low'&&action.edge!=='high')throw new Error('Choose the lowest or highest card.');
  card=action.edge==='low'?hand.shift():hand.pop();source='hand';owner=target;position=action.edge;
 }else throw new Error('Unknown move.');
 room.revealed.push({card,source,owner,position});
 const values=room.revealed.map(r=>r.card.value);
 if(values.some(v=>v!==values[0])){
  // Keep picked cards visible briefly before clearing the reveal and passing the turn.
  room.status='resolving';
  room.lastMessage='Not a match. Showing the picked card before the next turn.';
  setTimeout(()=>{
   if(room.status!=='resolving')return;
   resetRevealed(room);
   nextTurn(room);
   room.status='playing';
   emitRoom(room);
  },1600);
  return;
 }
 if(room.revealed.length===3){
  const value=values[0];const set={value,winner:playerIndex,team:isTeam(room)?room.players[playerIndex].team:null};room.sets.push(set);
  room.revealed=[];
  const winner=winnerFor(room,playerIndex);
  if(winner){room.winner=winner;room.status='finished';room.lastMessage=`${winner} wins!`;return;}
  room.lastMessage=`${room.players[playerIndex].name} collected the ${value}s!`;
  if(isTeam(room)){
   const opponents=[...new Set(room.players.filter(p=>p.team!==set.team).map(p=>p.team))];
   nextTurn(room);startSwap(room,opponents);
  }else nextTurn(room);
 }
}
io.on('connection',socket=>{
 socket.on('createRoom',({name,mode='simple'})=>{
  try{if(!name?.trim())throw new Error('Enter your name.');if(!['simple','spicy','team-simple','team-spicy'].includes(mode))throw new Error('Invalid mode.');let c;do{c=code();}while(rooms.has(c));
   const room={code:c,mode,players:[{id:socket.id,name:name.trim().slice(0,18),hand:[],team:0,connected:true}],middle:[],revealed:[],sets:[],current:0,turn:0,status:'lobby',winner:null,swapFor:[],lastMessage:'Waiting for friends to join.'};rooms.set(c,room);socket.join(c);socket.emit('joined',{code:c});emitRoom(room);
  }catch(e){fail(socket,e.message);}
 });
 socket.on('joinRoom',({code:c,name})=>{try{const room=rooms.get((c||'').toUpperCase());if(!room)throw new Error('Room not found. Check the code.');if(room.status!=='lobby')throw new Error('This game has already started.');if(room.players.length>=6)throw new Error('This room is full.');if(!name?.trim())throw new Error('Enter your name.');if(room.players.some(p=>p.name.toLowerCase()===name.trim().toLowerCase()))throw new Error('That name is already taken in this room.');room.players.push({id:socket.id,name:name.trim().slice(0,18),hand:[],team:0,connected:true});socket.join(room.code);socket.emit('joined',{code:room.code});room.lastMessage=`${name.trim()} joined the room.`;emitRoom(room);}catch(e){fail(socket,e.message);}});
 socket.on('startGame',()=>{const room=[...rooms.values()].find(r=>r.players.some(p=>p.id===socket.id));try{if(!room)throw new Error('Room not found.');if(room.players[0].id!==socket.id)throw new Error('Only the room host can start.');startGame(room);emitRoom(room);}catch(e){fail(socket,e.message);}});
 socket.on('reveal',action=>{const room=[...rooms.values()].find(r=>r.players.some(p=>p.id===socket.id));try{if(!room)throw new Error('Room not found.');const idx=room.players.findIndex(p=>p.id===socket.id);doReveal(room,idx,action);emitRoom(room);}catch(e){fail(socket,e.message);}});
 socket.on('swapSelect',({cardIndex})=>{const room=[...rooms.values()].find(r=>r.players.some(p=>p.id===socket.id));try{if(!room||room.status!=='swap')throw new Error('No swap is active.');const idx=room.players.findIndex(p=>p.id===socket.id),p=room.players[idx];if(!room.swapFor.includes(p.team))throw new Error('Your team is not part of this swap.');if(!Number.isInteger(cardIndex)||cardIndex<0||cardIndex>=p.hand.length)throw new Error('Invalid card selection.');p.swapChoice=cardIndex;p.swapReady=true;finishSwapIfReady(room);emitRoom(room);}catch(e){fail(socket,e.message);}});
 socket.on('swapSkip',()=>{const room=[...rooms.values()].find(r=>r.players.some(p=>p.id===socket.id));try{if(!room||room.status!=='swap')throw new Error('No swap is active.');const p=room.players.find(p=>p.id===socket.id);if(!room.swapFor.includes(p.team))throw new Error('Your team is not part of this swap.');p.swapChoice=null;p.swapReady=true;finishSwapIfReady(room);emitRoom(room);}catch(e){fail(socket,e.message);}});
 socket.on('disconnect',()=>{for(const room of rooms.values()){const p=room.players.find(p=>p.id===socket.id);if(p){p.connected=false;room.lastMessage=`${p.name} disconnected. The room remains active.`;emitRoom(room);break;}}});
});
if (!process.env.VERCEL) {
  httpServer.listen(PORT,()=>console.log(`Trio server listening on ${PORT}`));
}

// Vercel uses this HTTP server as the service entrypoint. Exporting the
// server (rather than calling listen()) also lets Socket.IO handle upgrades.
export default httpServer;
