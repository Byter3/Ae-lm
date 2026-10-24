(function () {
  'use strict';
  const el=id=>document.getElementById(id);
  let controller, began=0, rendered='', pendingId=null, connecting=false, connectEpoch=0, connectAbort=null;
  const expanded=new Set();
  function error(message) { el('error').textContent=message; el('error').hidden=!message; }
  function textBlock(parent,text) {
    // Model/history text never enters innerHTML, URLs, style attributes or executable markup.
    const pieces=String(text || '').split(/```[^\n]*\n([\s\S]*?)```/g);
    pieces.forEach((piece,index)=>{
      const node=document.createElement(index%2?'pre':'div'); node.className='text'; node.textContent=piece; parent.appendChild(node);
    });
  }
  function activity(receipt) {
    const box=document.createElement('details'); box.className='activity'; box.open=expanded.has(receipt.id);
    box.addEventListener('toggle',()=>{if(box.open) expanded.add(receipt.id); else expanded.delete(receipt.id);});
    const summary=document.createElement('summary'); summary.textContent=receipt.title;
    const partial=receipt.result&&receipt.result._aelmHost&&receipt.result._aelmHost.partial===true;
    const status=document.createElement('small'); status.textContent=receipt.status+(partial?' · partial output':'')+' · '+(receipt.kind==='script'?'Inspect exact script and result':'Inspect query and result'); summary.appendChild(status); box.appendChild(summary);
    const detail=document.createElement('div'); detail.className='detail';
    const code=document.createElement('pre'); code.textContent=receipt.source; detail.appendChild(code);
    if(receipt.result!==undefined){const result=document.createElement('pre');result.className='result';result.textContent=JSON.stringify(receipt.result,null,2);detail.appendChild(result);}
    box.appendChild(detail); return box;
  }
  function render(state) {
    el('send').disabled=state.busy||connecting; el('retry').disabled=state.busy||connecting || !state.archive.messages.length;
    el('inspect').disabled=state.busy||connecting; el('connect').disabled=state.busy||connecting; el('model').disabled=state.busy||connecting;
    ['server','token','useHoulm'].forEach(id=>{el(id).disabled=state.busy||connecting;});
    el('autoRun').disabled=state.busy; el('progress').hidden=!state.busy;
    if(state.busy&&!began) began=Date.now(); if(!state.busy) began=0;
    el('history').textContent=state.store.path ? state.store.path.split(/[\\/]/).pop() : 'Unsaved · memory only';
    el('history').title=state.historyStatus;
    error(state.error);
    pendingId=state.pending&&state.pending.id;
    el('review').hidden=!pendingId;
    if(pendingId){const r=state.archive.receipts.find(r=>r.id===pendingId);el('reviewTitle').textContent=r.title;el('reviewSource').textContent=r.source;el('reviewTarget').textContent=state.identity.projectPath||'Current unsaved project';}
    const signature=JSON.stringify([state.archive.messages,state.archive.receipts]);
    if(signature===rendered) return; rendered=signature;
    const transcript=el('transcript'); const nearEnd=transcript.scrollHeight-transcript.scrollTop-transcript.clientHeight<100;
    transcript.replaceChildren();
    if(!state.archive.messages.length){const welcome=document.createElement('div');welcome.className='welcome';const title=document.createElement('h1');title.textContent='Work with your composition.';const description=document.createElement('p');description.textContent='Start with Inspect for a local read, or connect to your studio in Settings.';welcome.appendChild(title);welcome.appendChild(description);transcript.appendChild(welcome);return;}
    const shown=state.archive.messages.slice(-250);
    if(shown.length<state.archive.messages.length){const n=document.createElement('p');n.className='muted';n.textContent='Showing recent messages. The full conversation remains in the project JSON.';transcript.appendChild(n);}
    shown.forEach(message=>{
      if(message.role==='tool') return;
      if(message.content){const box=document.createElement('article');box.className='message '+message.role;const name=document.createElement('div');name.className='speaker';name.textContent=message.role==='user'?'You':'Ae-lm';box.appendChild(name);textBlock(box,message.content);transcript.appendChild(box);}
      (message.tool_calls||[]).forEach(call=>{const r=state.archive.receipts.find(r=>r.id===call.id);if(r) transcript.appendChild(activity(r));});
    });
    if(nearEnd||state.busy) transcript.scrollTop=transcript.scrollHeight;
  }
  function progress(p) {
    const names={connecting:'Connecting…',uploaded:'Waiting for server…',headers:'Receiving response…',receiving:'Receiving response…',model:'Thinking…',approval:'Review needed',host:'Working in After Effects…',stopping:'Stopping…'};
    el('phase').textContent=names[p.phase]||'Working…';
    el('progressDetail').textContent=p.detail || ({connecting:'Connecting to your configured studio service.',uploaded:'Request uploaded. Waiting for response data.',headers:'The server responded.',receiving:'Receiving model output. Commands run only after a complete validated response.'}[p.phase]) || '';
  }
  async function run(fn){try{await fn();}catch(e){error(e.message||'Operation failed.');}}
  try {
    if(!window.__adobe_cep__) throw new Error('Open this panel from After Effects → Window → Extensions → Ae-lm Assistant.');
    const nodeRequire=window.cep_node ? window.cep_node.require : window.require;
    if(!nodeRequire) throw new Error('The AE panel runtime did not enable Node integration. Reinstall the complete extension folder.');
    const path=nodeRequire('path'), fs=nodeRequire('fs'), os=nodeRequire('os');
    let root=decodeURI(window.__adobe_cep__.getSystemPath('extension')).replace(/^file:\/\/\//,'');
    if(!/^[A-Za-z]:/.test(root)&&root[0]!=='/') root='/'+root;
    const {Bridge}=nodeRequire(path.join(root,'lib','bridge.js'));
    const {HistoryStore}=nodeRequire(path.join(root,'lib','history.js'));
    const {Controller}=nodeRequire(path.join(root,'lib','controller.js'));
    const transport=nodeRequire(path.join(root,'lib','transport.js'));
    const sharedSettings=nodeRequire(path.join(root,'lib','settings.js'));
    const prefPath=path.join(os.homedir(),'.aelm-settings.json');
    const initial=sharedSettings.readSettings();
    let prefs={baseUrl:initial.baseUrl,model:initial.model}, houlm=initial.houlm;
    el('server').value=prefs.baseUrl;
    function matchingHouServer(){try{return houlm&&transport.normalizeBaseUrl(el('server').value.trim())===houlm.baseUrl;}catch(ignore){return false;}}
    function connectionHint(){
      el('connectionHint').textContent=matchingHouServer()
        ? 'Hou-lm settings found. Leave the key blank to use its saved Windows login, then click Connect.'
        : 'Enter your Open WebUI key to connect. Use Hou-lm settings to reload its saved server and model.';
      el('token').placeholder=matchingHouServer()?'Use saved Hou-lm login (if available)':'';
    }
    connectionHint();
    // Only URL/model preferences persist. Tokens, approvals and Auto-run never do.
    const bridge=new Bridge({evalScript:(source,callback)=>window.__adobe_cep__.evalScript(source,callback)});
    controller=new Controller({bridge,store:new HistoryStore(),onChange:render,onProgress:progress});
    window.addEventListener('beforeunload',()=>{connectEpoch++;if(connectAbort)connectAbort.abort();controller.stop();controller.connection.token='';el('token').value='';});
    try{const host=JSON.parse(window.__adobe_cep__.getHostEnvironment());const skin=host.appSkinInfo;
      if(skin&&skin.baseFontSize>=11) document.documentElement.style.fontSize=Math.min(skin.baseFontSize,18)+'px';
      if(skin&&skin.baseFontFamily) document.documentElement.style.fontFamily=skin.baseFontFamily+', Arial, sans-serif';
    }catch(ignore){}
    el('settingsToggle').onclick=()=>{el('settings').hidden=!el('settings').hidden;el('settingsToggle').setAttribute('aria-expanded',String(!el('settings').hidden));};
    function disconnect(){
      connectEpoch++;if(connectAbort)connectAbort.abort();connectAbort=null;connecting=false;
      controller.connection={baseUrl:'',token:'',model:''};el('connection').textContent='Not connected';
      connectionHint();render(controller);
    }
    el('server').oninput=()=>{if(controller.busy)return;el('token').value='';disconnect();};
    el('token').oninput=()=>{if(!controller.busy)disconnect();};
    el('useHoulm').onclick=()=>{
      if(controller.busy||connecting)return;
      houlm=sharedSettings.readSettings().houlm;
      if(!houlm){error('No valid Hou-lm connection settings were found for this Windows user. Enter the connection here.');return;}
      prefs={baseUrl:houlm.baseUrl,model:houlm.model};el('server').value=prefs.baseUrl;el('token').value='';
      disconnect();error('');
    };
    el('connect').onclick=()=>run(async()=>{
      if(connecting||controller.busy)return;
      connecting=true;const epoch=++connectEpoch;connectAbort=new AbortController();
      controller.connection={baseUrl:'',token:'',model:''};render(controller);
      el('connection').textContent='Connecting…';error('');
      try{
        const baseUrl=transport.normalizeBaseUrl(el('server').value.trim());
        const token=el('token').value.trim()||await sharedSettings.loadHouToken(houlm,baseUrl);
        if(epoch!==connectEpoch)return;
        if(!token)throw new Error('No saved Hou-lm login is available for this server. Enter your Open WebUI key here, or save the login in Hou-lm first.');
        const models=await transport.listModels({baseUrl,token,signal:connectAbort.signal});
        if(epoch!==connectEpoch)return;
        if(!models.length) throw new Error('This account returned no models.');
        el('model').replaceChildren();models.forEach(model=>{const option=document.createElement('option');option.value=model.id;option.textContent=model.name||model.id;el('model').appendChild(option);});
        if(models.some(m=>m.id===prefs.model)) el('model').value=prefs.model;
        controller.configure({baseUrl,token,model:el('model').value});
        prefs={baseUrl,model:el('model').value};
        try{fs.writeFileSync(prefPath,JSON.stringify(prefs),'utf8');}catch(ignore){}
        el('connection').textContent='Connected';el('settings').hidden=true;el('settingsToggle').setAttribute('aria-expanded','false');
      }catch(e){el('connection').textContent='Connection failed';throw e;}finally{if(epoch===connectEpoch){connecting=false;connectAbort=null;render(controller);}}
    });
    el('model').onchange=()=>{if(controller.busy)return;controller.connection.model=el('model').value;prefs.model=el('model').value;try{fs.writeFileSync(prefPath,JSON.stringify(prefs),'utf8');}catch(ignore){}};
    el('autoRun').onchange=()=>{controller.autoRun=el('autoRun').checked;};
    el('inspect').onclick=()=>run(()=>controller.inspectLocal());
    el('composer').onsubmit=event=>{event.preventDefault();const text=el('prompt').value;if(text.trim()&&!controller.busy&&!connecting){if(!controller.connection.token){error('Connect to your studio in Settings first.');return;}el('prompt').value='';run(()=>controller.send(text));}};
    el('prompt').onkeydown=event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();el('composer').requestSubmit();}};
    el('retry').onclick=()=>run(()=>controller.retry());el('stop').onclick=()=>controller.stop();
    el('approve').onclick=()=>controller.decide(pendingId,true);el('reject').onclick=()=>controller.decide(pendingId,false);
    el('settings').hidden=false;el('settingsToggle').setAttribute('aria-expanded','true');
    run(()=>controller.syncProject());
    setInterval(()=>{if(began){const seconds=Math.floor((Date.now()-began)/1000);el('elapsed').textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');}},500);
    // Detect Save As and project switches without inspecting layers or triggering evaluation.
    setInterval(()=>{if(!controller.busy&&!connecting)run(()=>controller.syncProject());},5000);
  } catch(e){error(e.message);el('settings').hidden=false;el('send').disabled=true;el('inspect').disabled=true;}
})();
