import WebSocket from 'ws';
const BASE='http://43.251.226.134';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

const reg = await (await fetch(BASE+'/api/devices/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceUid:'nginx-test-01',name:'公网链路测试机',token:'dt_nginxtest0001'})})).json();
console.log('注册:', reg.ok, reg.data?.id);

const login = await (await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})})).json();
const token = login.data?.token;
console.log('登录:', login.ok);

const ws = new WebSocket('ws://43.251.226.134/ws/agent?token=dt_nginxtest0001');
await new Promise((res,rej)=>{ws.on('open',res);ws.on('error',rej);setTimeout(()=>rej(new Error('超时')),10000)});
console.log('WS 升级成功（经过 Nginx）');

ws.on('message',(b)=>{const m=JSON.parse(b.toString()); if(m.type==='command'){ws.send(JSON.stringify({type:'result',requestId:m.requestId,ok:true,stdout:'pong via nginx',stderr:'',exitCode:0,durationMs:3}))}});
ws.send(JSON.stringify({type:'hello',device:{model:'TestModel',androidVersion:'16',rootStatus:'granted',battery:88,network:'wifi',ip:'1.1.1.1'}}));
await sleep(800);

const dev = await (await fetch(BASE+'/api/devices/'+reg.data.id,{headers:{Authorization:'Bearer '+token}})).json();
console.log('设备在线:', dev.data?.online, '| 型号:', dev.data?.model, '| 电量:', dev.data?.battery);

const cmd = await (await fetch(BASE+'/api/devices/'+reg.data.id+'/command',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({type:'shell',params:{command:'echo hi'}})})).json();
console.log('远程指令经 Nginx 往返:', cmd.data?.status, '| stdout:', cmd.data?.stdout);
ws.close();
