'use strict';
// Local development inspection only. CEP 12 needs page-level CDP (no browser contexts).
async function connect(port=9234) {
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json',{signal:AbortSignal.timeout(3000)})).json();
  const target=targets.find(t=>t.type==='page'&&/local\.aebrowse.*index\.html/.test(t.url));
  if(!target) throw Error('AE Browse debugging target unavailable');
  const socket=new WebSocket(target.webSocketDebuggerUrl), pending=new Map(); let sequence=0;
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{const data=JSON.parse(event.data),entry=pending.get(data.id);if(entry){pending.delete(data.id);clearTimeout(entry.timer);data.error?entry.reject(Error(JSON.stringify(data.error))):entry.resolve(data.result);}});
  function call(method,params={}) { return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CEP command timeout: '+method));},5000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));}); }
  async function evaluate(expression) {const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
  return {call,evaluate,close:()=>socket.close(),host:script=>evaluate('new Promise(resolve=>new CSInterface().evalScript('+JSON.stringify(script)+',resolve))')};
}
module.exports={connect};
if(require.main===module) (async()=>{const c=await connect();try{console.log(await c.evaluate("({status:document.querySelector('#status').textContent,pathEntry:!document.querySelector('#path-entry').hidden})"));}finally{c.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
