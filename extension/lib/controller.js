'use strict';
const crypto = require('crypto');
const {createArchive} = require('./history');
const defaultProtocol = require('./protocol');
const defaultTransport = require('./transport');
const {buildContext} = require('./context');
const visual = require('./visuals');

class Controller {
  constructor(options) {
    this.bridge = options.bridge;
    this.store = options.store;
    this.transport = options.transport || defaultTransport;
    this.protocol = options.protocol || defaultProtocol;
    this.onChange = options.onChange || function () {};
    this.onProgress = options.onProgress || function () {};
    this.archive = createArchive();
    this.connection = {baseUrl:'',token:'',model:''};
    this.identity = null;
    this.busy = false;
    this.autoRun = false;
    this.viewportAccess = false;
    this.captureView = options.captureView || null;
    this.references = [];
    this.pending = null;
    this.error = '';
    this.historyStatus = 'Unsaved project — history is in memory';
    this.maxCaptures = visual.captureBudget(options.maxCaptures);
    this._explicitMaxSteps = options.maxSteps !== undefined;
    this.maxSteps = options.maxSteps || 24;
    this.maxContextChars = options.maxContextChars || 96000;
    this._epoch = 0;
    this._saveTail = Promise.resolve();
  }
  changed() { this.onChange(this); }
  configure(settings) {
    if (this.busy) throw new Error('Stop the current request before changing the connection.');
    this.connection = {baseUrl:this.transport.normalizeBaseUrl(settings.baseUrl),token:settings.token,model:settings.model};
    this.error = ''; this.changed();
  }
  async syncProject() {
    await this._saveTail;
    const response = await this.bridge.identity();
    if (!response.ok) throw new Error(response.error.message);
    const next = response.data;
    if (!this.identity || next.projectToken !== this.identity.projectToken || next.projectPath !== this.identity.projectPath) {
      const firstBinding=!this.identity;
      const sameProject = this.identity && next.projectToken === this.identity.projectToken;
      const binding = this.store.bind(next.projectPath || '', sameProject ? {carry:this.archive} : {});
      this.archive = binding.archive;
      this.identity = next;
      if(!sameProject){
        this.viewportAccess=false;
        if(!firstBinding)this.references=[];
      }
      this.historyStatus = this.store.path ? 'History: ' + this.store.path : 'Unsaved project — history is in memory';
      if(this.store.assets.unavailable.length)this.historyStatus+=' · Some historical images are unavailable.';
      await this.persist();
      this.changed();
    } else { this.identity = next; }
    return next;
  }
  async persist() {
    const save=this._saveTail.then(()=>{
      this.archive.updatedAt = new Date().toISOString();
      return typeof this.store.saveAsync==='function' ? this.store.saveAsync(this.archive) : this.store.save(this.archive);
    });
    this._saveTail=save.catch(()=>{});
    const result=await save;
    if(result&&result.warning)this.historyStatus=result.warning;
    return result;
  }
  async refreshTarget() {
    await this._saveTail;
    const response=await this.bridge.identity();
    if(!response.ok) throw new Error(response.error.message);
    const next=response.data;
    if(!this.identity || next.projectToken!==this.identity.projectToken) throw new Error('The active project changed. Send a new request for that project.');
    if(next.projectPath!==this.identity.projectPath) {
      this.store.bind(next.projectPath||'',{carry:this.archive});
      this.identity=next;
      this.historyStatus=this.store.path?'History: '+this.store.path:'Unsaved project — history is in memory';
      if(this.store.assets.unavailable.length)this.historyStatus+=' · Some historical images are unavailable.';
    }
    return next;
  }
  async send(text, onAccepted) {
    if (this.busy || !text.trim()) return;
    await this.begin(text.trim(), onAccepted);
  }
  async setReferences(references) {
    if(this.busy) throw new Error('Wait for the current request before changing references.');
    if(!Array.isArray(references)||references.length>visual.MAX_REFERENCES) throw new Error('Attach at most three reference images.');
    this.references=references.map(ref=>{
      if(ref.item){this.store.assets.read(ref.item);return ref;}
      visual.imageInfo(ref.bytes);return {bytes:Buffer.from(ref.bytes),mime:ref.mime,name:ref.name};
    });
    this.changed();
  }
  activeReferences(){return visual.activeReferenceItems(this.archive);}
  async clearActiveReferences(){
    if(this.busy)throw new Error('Wait for the current request before changing conversation references.');
    if(this.archive.visuals){this.archive.visuals.activeReferences=[];try{await this.persist();}finally{this.changed();}}
  }
  setMaxCaptures(value){
    if(this.busy)throw new Error('Wait for the current request before changing the visual-check budget.');
    this.maxCaptures=visual.captureBudget(value);this.changed();
  }
  captureAttempts(){
    const ids=new Set();
    for(let i=this.archive.messages.length-1;i>=0;i--){const message=this.archive.messages[i];if(message.role==='user')break;for(const call of message.tool_calls||[])ids.add(call.id);}
    return this.archive.receipts.filter(r=>r.kind==='capture'&&r.authorization==='viewport-access'&&ids.has(r.id)).length;
  }
  referenceBytes(ref){return ref.item?this.store.assets.read(ref.item):ref.bytes;}
  referenceUrl(ref){return 'data:'+ref.mime+';base64,'+this.referenceBytes(ref).toString('base64');}
  async retry() {
    if (this.busy || !this.archive.messages.length) return;
    await this.begin(null);
  }
  async inspectLocal() {
    if (this.busy) return;
    this.busy=true; this.stopped=false; this.error=''; this.changed();
    try {
      await this.syncProject();
      if(this.stopped) return;
      const id='local-'+crypto.randomBytes(12).toString('hex');
      const args={scope:'activeComp',offset:0,limit:10};
      this.archive.messages.push({role:'user',content:'Inspect the active composition locally. Do not modify anything or render.'});
      this.archive.messages.push({role:'assistant',content:'Reading the active composition directly from After Effects.',tool_calls:[{id,type:'function',function:{name:'ae_inspect',arguments:JSON.stringify(args)}}]});
      await this.perform({id,name:'ae_inspect',args});
    } catch(error) { this.error=error.message; this.settleUnanswered(); }
    finally { this.busy=false; this.changed(); }
  }
  recoveryState() {
    let failure=null, inspected=false;
    const blockedSources=new Set();
    for(const receipt of this.archive.receipts) {
      const result=receipt.result, error=result&&result.error;
      if(receipt.kind==='script'&&receipt.status==='failed'&&result&&result.ok===false&&error&&error.code==='script_failed'&&error.possiblyModified===true) {
        failure=receipt;inspected=false;blockedSources.add(crypto.createHash('sha256').update(receipt.source).digest('hex'));
      } else if(failure&&receipt.kind==='read'&&receipt.status==='completed'&&result&&result.ok===true) {
        inspected=true;
      } else if(failure&&inspected&&receipt.kind==='script'&&receipt.status==='completed'&&result&&result.ok===true&&!blockedSources.has(crypto.createHash('sha256').update(receipt.source).digest('hex'))) {
        // A different script succeeded after inspecting the partial state.
        // Derive this from receipts so retry/reload cannot forget a failure.
        failure=null;inspected=false;
        // A successful diagnostic or unrelated script is not proof that it is
        // safe to replay old partially applied source. Keep its digest blocked.
      }
    }
    return {failure,blockedSources,needsInspection:!!failure&&this._recoveryObserved!==failure.id};
  }
  cancelCalls(calls,code,message) {
    for(const call of calls)this.addToolResult(call.id,{ok:false,error:{code,message,possiblyModified:false}});
  }
  async begin(text, onAccepted) {
    if (!this.connection.model || !this.connection.token) throw new Error('Connect to your studio and choose a model first.');
    this.busy = true; this.error = ''; this.stopped = false;
    this._recoveryObserved=null;
    const epoch = ++this._epoch;
    this.abort = new AbortController();
    this.changed();
    try {
      await this.syncProject();
      if(this.stopped) return;
      if (text !== null) {
        const prepared=this.references.map(ref=>({bytes:this.referenceBytes(ref),name:ref.name,mime:ref.mime}));
        const priorMessages=this.archive.messages.slice(), priorVersion=this.archive.schemaVersion;
        const priorVisuals=this.archive.visuals?JSON.parse(JSON.stringify(this.archive.visuals)):null;
        try{
          this.archive.messages.push({role:'user',content:text});
          if(prepared.length){
            const added=prepared.map(ref=>this.store.assets.add(this.archive,ref,'reference'));
            this.archive.visuals.activeReferences=added.map(item=>item.id);
          }
          await this.persist();
        }catch(error){
          this.archive.messages=priorMessages;this.archive.schemaVersion=priorVersion;
          if(priorVisuals)this.archive.visuals=priorVisuals;else delete this.archive.visuals;
          throw error;
        }
        this.references=[];
        // The UI can clear only the submitted draft after durable acceptance.
        if(typeof onAccepted==='function')onAccepted();
      }else await this.persist();
      this.changed();
      const stepLimit=this._explicitMaxSteps||!this.viewportAccess||typeof this.captureView!=='function'?this.maxSteps:Math.max(this.maxSteps,this.maxCaptures*4+8);
      for (let step = 0; step < stepLimit; step++) {
        if (this.stopped || epoch !== this._epoch) break;
        const hasImages=this.activeReferences().length>0||visual.items(this.archive).some(item=>item.kind==='capture'&&item.userTurn===visual.turnNumber(this.archive));
        const visionEnabled=this.viewportAccess&&typeof this.captureView==='function';
        const recovery=this.recoveryState();
        const recoveryNote=!recovery.failure?'':recovery.needsInspection?
          '\nA previous script returned a known error and may have partially changed the project. The remaining calls from that response were not dispatched. Your next tool response must contain only ae_inspect calls: inspect the relevant current targets and surviving partial changes before proposing a repair. Do not rerun the failed source or use a capture as a substitute for inspection. You may explain a blocker and stop.':
          '\nA fresh authored-state inspection has returned after the previous script failure. If a repair is appropriate, write a new focused script from the observed current state, preserving changes already present. Do not replay the failed source unchanged. Normal local review or Auto-run still applies. If blocked, explain what needs the artist.';
        const context = buildContext(this.archive.messages,{system:this.protocol.SYSTEM_PROMPT+recoveryNote+(hasImages||visionEnabled?'\n'+visual.visionNote(this.maxCaptures,this.captureAttempts()):''),maxChars:this.maxContextChars});
        const modelMessages=visual.injectImages(context.messages,this.archive,this.store.assets);
        const modelTools=recovery.needsInspection?this.protocol.TOOLS.filter(tool=>tool.function.name==='ae_inspect'):visionEnabled?this.protocol.TOOLS.concat([visual.captureTool(this.maxCaptures)]):this.protocol.TOOLS;
        this.onProgress({phase:'model',detail:context.compactedResults ? 'Requesting the model with smaller previews of large tool results. Exact commands and full results remain in local history.' : context.compacted ? 'Requesting the model; older turns omitted from this request. Full history remains local.' : 'Requesting the model.'});
        const result = await this.transport.request({baseUrl:this.connection.baseUrl,token:this.connection.token,
          path:'/api/chat/completions',body:{model:this.connection.model,messages:modelMessages,tools:modelTools,stream:true},
          signal:this.abort.signal,onProgress:p=>this.onProgress(p)});
        if (this.stopped || epoch !== this._epoch) break;
        await this.refreshTarget();
        if(this.stopped) break;
        const answer = this.protocol.parseCompletion(result.body,result.headers['content-type'] || '');
        const calls = this.protocol.validateToolCalls(answer.tool_calls || []);
        const seen = new Set(this.archive.messages.flatMap(message=>(message.tool_calls||[]).map(call=>call.id)));
        if (calls.some(c=>seen.has(c.id))) throw new Error('The model reused an earlier command ID. No commands from this response ran.');
        this.archive.messages.push(answer);
        await this.persist(); this.changed();
        if (!calls.length) return;
        if(recovery.needsInspection&&calls.some(call=>call.name!=='ae_inspect')) {
          this.cancelCalls(calls,'recovery_inspection_required','This entire response was not dispatched. After the earlier script failure, first inspect the partial state with ae_inspect and wait for its results before proposing any repair or capture.');
          await this.persist();this.changed();continue;
        }
        if(calls.some(call=>call.name==='ae_run_script'&&recovery.blockedSources.has(crypto.createHash('sha256').update(call.args.source).digest('hex')))) {
          this.cancelCalls(calls,'failed_source_replay','This entire response was not dispatched because it repeats source from a failed script. Inspect the current partial state and write a new focused repair; do not replay the failed command under a new ID.');
          await this.persist();this.changed();continue;
        }
        for (let callIndex=0;callIndex<calls.length;callIndex++) {
          const call=calls[callIndex];
          if (this.stopped) {
            this.addToolResult(call.id,{ok:false,error:{code:'cancelled',message:'Stopped before execution.'}});
            continue;
          }
          const outcome=await this.perform(call);
          if(outcome&&outcome.recoverableFailure) {
            this.cancelCalls(calls.slice(callIndex+1),'batch_cancelled','Not dispatched: an earlier script in this response failed. Inspect its partial changes before proposing a new repair.');
            this.onProgress({phase:'recovery',detail:'The script returned an error. Remaining batch commands were cancelled; inspecting current state before a new repair.'});
            break;
          }
        }
        await this.persist(); this.changed();
      }
      if (!this.stopped) this.error = 'This turn reached its step limit. Completed commands are recorded. Continue with a narrower request.';
    } catch (error) {
      this.error = this.stopped ? 'Stopped. Completed changes remain in After Effects.' : (error.message || 'Request failed.');
      // Settle every unanswered call without executing it, including a partially completed batch.
      this.settleUnanswered();
      try { await this.persist(); } catch (saveError) { this.error += ' History was not saved: ' + saveError.message; }
    } finally {
      this.pending = null; this.busy = false; this.abort = null; this.changed();
    }
  }
  addToolResult(id,value) {
    this.archive.messages.push({role:'tool',tool_call_id:id,content:JSON.stringify(value)});
  }
  settleUnanswered() {
    const answered = new Set(this.archive.messages.filter(m=>m.role==='tool').map(m=>m.tool_call_id));
    for (const message of this.archive.messages) {
      for (const call of message.tool_calls || []) {
        if (!answered.has(call.id)) {
          const receipt = this.archive.receipts.find(r=>r.id===call.id);
          if (receipt && receipt.status==='running') receipt.status='unknown';
          if (receipt && receipt.status==='proposed') receipt.status='cancelled';
          this.addToolResult(call.id,{ok:false,error:{code:receipt && receipt.status==='unknown' ? 'unknown_outcome' : 'cancelled',
            message:'The turn stopped. Do not replay this command; inspect current state before proposing more work.'}});
          answered.add(call.id);
        }
      }
    }
  }
  notDispatched(receipt,call,code,message) {
    receipt.status=code==='cancelled'?'cancelled':'failed';
    delete receipt.startedAt;
    receipt.completedAt=new Date().toISOString();
    receipt.result={ok:false,error:{code,message,possiblyModified:false}};
    this.addToolResult(call.id,receipt.result);
  }
  async perform(call) {
    if(call.name==='ae_capture_view')return this.performCapture(call);
    const script = call.name === 'ae_run_script';
    const target = await this.refreshTarget();
    if(this.stopped) {this.addToolResult(call.id,{ok:false,error:{code:'cancelled',message:'Stopped before execution.'}});return;}
    const receipt = {id:call.id,title:script ? call.args.title : 'Inspect ' + (call.args.scope || 'activeComp'),
      source:script ? call.args.source : JSON.stringify(call.args,null,2),kind:script?'script':'read',
      status:'proposed',createdAt:new Date().toISOString(),targetProjectToken:target.projectToken};
    receipt.sourceHash = crypto.createHash('sha256').update(receipt.source).digest('hex');
    this.archive.receipts.push(receipt);
    try { await this.persist(); } catch(error) {
      this.notDispatched(receipt,call,'history_save_failed','The command was not dispatched because its history could not be saved.');
      throw error;
    }
    this.changed();
    if(this.stopped) {
      this.notDispatched(receipt,call,'cancelled','Stopped before execution.');
      await this.persist(); this.changed(); return;
    }
    if (script) {
      const approved = this.autoRun || await new Promise(resolve=>{
        this.pending = {id:receipt.id,resolve};
        this.onProgress({phase:'approval',detail:'Review the exact script below. It runs with After Effects permissions.'}); this.changed();
      });
      this.pending = null;
      if (!approved || this.stopped) {
        receipt.status = this.stopped ? 'cancelled':'rejected';
        receipt.result = {ok:false,error:{code:receipt.status,message:'The script was not executed.'}};
        this.addToolResult(call.id,receipt.result); await this.persist(); this.changed(); return;
      }
      receipt.authorization = this.autoRun ? 'auto-run':'manual';
    }
    try {
      await this.refreshTarget();
      if(this.stopped) {
        this.notDispatched(receipt,call,'cancelled','Stopped before execution.');
        await this.persist(); this.changed(); return;
      }
      // Persist the conservative execution intent before crossing the host
      // boundary. If this save fails, dispatch has certainly not happened.
      receipt.status='running'; receipt.startedAt=new Date().toISOString();
      await this.persist();
    } catch(error) {
      if(!receipt.result)this.notDispatched(receipt,call,'not_dispatched','The command was not dispatched: '+error.message);
      throw error;
    }
    // Async disk retries let Stop and project switching occur. Recheck both
    // after the durable intent, immediately before host dispatch.
    try {
      await this.refreshTarget();
      if(this.stopped) {
        this.notDispatched(receipt,call,'cancelled','Stopped before execution.');
        await this.persist(); this.changed(); return;
      }
      this.onProgress({phase:'host',detail:script ? 'Running the approved script in After Effects. Stop prevents subsequent steps; it cannot guarantee interruption of this script.' : 'Reading live project data. No preview or render requested.'});
    } catch(error) {
      if(!receipt.result)this.notDispatched(receipt,call,'not_dispatched','The command was not dispatched: '+error.message);
      throw error;
    }
    this.changed();
    try {
      receipt.result = script ? await this.bridge.execute({id:receipt.id,source:receipt.source,title:receipt.title,expectedProjectToken:receipt.targetProjectToken}) : await this.bridge.inspect(call.args);
      receipt.status = receipt.result.ok ? 'completed':'failed';
    } catch (error) {
      receipt.status = script && error.outcome==='unknown' ? 'unknown':'failed';
      receipt.result = {ok:false,error:{code:error.code || 'host_error',message:error.message,possiblyModified:receipt.status==='unknown'}};
    }
    receipt.completedAt=new Date().toISOString();
    this.addToolResult(call.id,receipt.result);
    // Bind Save As before the next disk write, while keeping a switched project's result in its originating archive.
    const after=await this.bridge.identity().catch(()=>null);
    if(after && after.ok && after.data.projectToken===this.identity.projectToken && after.data.projectPath!==this.identity.projectPath) await this.refreshTarget();
    await this.persist(); this.changed();
    if (receipt.status==='unknown') throw new Error('The script outcome is unknown. It will not be retried. Inspect After Effects before continuing.');
    if(after && after.ok && after.data.projectToken!==this.identity.projectToken) throw new Error('The script changed the active project. Its outcome was recorded; send a new request for the new project.');
    if(script&&!receipt.result.ok&&receipt.result.error&&receipt.result.error.code==='script_failed'&&receipt.result.error.possiblyModified!==true) {
      throw new Error('The host returned incompatible script-failure metadata. Its result was recorded; no automatic repair was started.');
    }
    if(script && !receipt.result.ok && receipt.result.error && receipt.result.error.possiblyModified) {
      if(receipt.result.error.code==='script_failed') {
        if(!after||!after.ok)throw new Error('The script failed, and the current project could not be confirmed. Its result was recorded; inspect After Effects before continuing.');
        this._recoveryObserved=null;
        return {recoverableFailure:true};
      }
      throw new Error(receipt.result.error.message + ' [' + receipt.result.error.code + '] Earlier edits may remain. The remaining batch was stopped; inspect the project before continuing.');
    }
    if(!script&&receipt.status==='completed'&&receipt.result.ok) {
      const recovery=this.recoveryState();
      if(recovery.failure) {
        if(!after||!after.ok)throw new Error('The inspection returned, but the current project could not be confirmed. No repair was dispatched.');
        this._recoveryObserved=recovery.failure.id;
      }
    }
  }
  async performCapture(call) {
    const target=await this.refreshTarget();
    const count=this.captureAttempts();
    const receipt={id:call.id,title:'Capture visible view: '+call.args.reason,source:JSON.stringify(call.args),kind:'capture',status:'running',createdAt:new Date().toISOString(),targetProjectToken:target.projectToken};
    this.archive.receipts.push(receipt);
    try{
      if(this.stopped)throw Object.assign(new Error('Capture cancelled before it started.'),{code:'cancelled'});
      if(!this.viewportAccess||typeof this.captureView!=='function')throw Object.assign(new Error('Viewport access is off. Enable it locally to allow screenshots of the visible Composition viewer.'),{code:'capture_disabled'});
      if(count>=this.maxCaptures)throw Object.assign(new Error('This task has used its '+this.maxCaptures+' visual checks. Summarize the result and remaining differences, or continue in a new user turn.'),{code:'capture_limit'});
      receipt.authorization='viewport-access';receipt.startedAt=new Date().toISOString();await this.persist();this.changed();
      if(this.stopped||!this.viewportAccess)throw Object.assign(new Error('Capture cancelled before it started.'),{code:'cancelled'});
      await this.refreshTarget();
      if(this.stopped||!this.viewportAccess)throw Object.assign(new Error('Capture cancelled before it started.'),{code:'cancelled'});
      this.onProgress({phase:'capture',detail:'Capturing the visible AE viewer region. No render, preview or time change requested.'});
      const before=await this.bridge.inspect({scope:'activeComp',offset:0,limit:1});
      if(!before||!before.ok)throw Object.assign(new Error('AE could not provide the current viewer state. No image was captured.'),{code:'capture_viewer_unavailable'});
      const viewer=before.data&&before.data.viewer;
      await this.refreshTarget();
      if(this.stopped||!this.viewportAccess)throw Object.assign(new Error('Capture cancelled before it started.'),{code:'cancelled'});
      const capture=await this.captureView({signal:this.abort&&this.abort.signal,maxWidth:visual.MAX_EDGE,maxHeight:visual.MAX_EDGE,viewerType:viewer&&viewer.type});
      await this.refreshTarget();
      if(this.stopped||!this.viewportAccess)throw Object.assign(new Error('Capture was cancelled or permission was revoked. No image was attached.'),{code:'cancelled'});
      const after=await this.bridge.inspect({scope:'activeComp',offset:0,limit:1});
      await this.refreshTarget();
      if(this.stopped||!this.viewportAccess)throw Object.assign(new Error('Capture was cancelled or permission was revoked. No image was attached.'),{code:'cancelled'});
      const a=before&&before.ok&&before.data&&before.data.comp,b=after&&after.ok&&after.data&&after.data.comp;
      if(!after||!after.ok||JSON.stringify(before.data&&before.data.viewer)!==JSON.stringify(after.data&&after.data.viewer)||JSON.stringify(a)!==JSON.stringify(b))throw Object.assign(new Error('The active composition changed during capture. No image was attached; capture again after the viewer settles.'),{code:'capture_changed'});
      const detected=capture.metadata&&capture.metadata.method==='detected-visible-viewer';
      const metadata={method:detected?'detected-visible-viewer':'selected-visible-region',capturedAt:new Date().toISOString(),activeComp:a?{id:a.id,name:a.name,time:a.time,frameRate:a.frameRate,width:a.width,height:a.height}:null,note:(detected?'Pixels from the sole detected visible AE viewer region.':'Pixels from the user-selected screen region.')+' Active composition metadata does not independently identify its viewer or prove a fresh rendered frame. No render, preview or time change requested.'};
      const item=this.store.assets.add(this.archive,{bytes:capture.bytes,mime:capture.mime,name:'Visible AE view'},'capture',{callId:call.id,observation:JSON.stringify(metadata)});
      receipt.result={ok:true,data:{assetId:item.id,sha256:item.sha256,width:item.width,height:item.height,observation:metadata,capturesRemaining:this.maxCaptures-count-1}};
      receipt.status='completed';
    }catch(e){receipt.status='failed';receipt.result={ok:false,error:{code:e.code||'capture_failed',message:e.message,possiblyModified:false}};}
    receipt.completedAt=new Date().toISOString();this.addToolResult(call.id,receipt.result);await this.persist();this.changed();
    if(receipt.result.error&&receipt.result.error.code==='capture_limit')throw new Error(receipt.result.error.message);
  }
  decide(id,approved) {
    if (!this.pending || this.pending.id!==id) return false;
    const pending=this.pending; this.pending=null; pending.resolve(approved===true); this.changed(); return true;
  }
  stop() {
    this.stopped=true;
    if(this.abort) this.abort.abort();
    if(this.pending) this.decide(this.pending.id,false);
    this.onProgress({phase:'stopping',detail:'Stopping subsequent steps. An already dispatched AE script may still be running.'});
  }
}
module.exports={Controller};
